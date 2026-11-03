import type { ContextRequest, RenameSessionRequest } from '../core/api.ts';
import type { ContextOnly } from '../core/context-export.ts';
import { TerrificError } from '../core/errors.ts';
import { parseEventQuery, queryEvents } from '../core/event-query.ts';
import { isRecord, isString } from '../core/validate.ts';
import type { createProjectStore } from '../store/projects.ts';
import { createSettingsStore, type SettingsPatch } from '../store/settings.ts';
import { type Router, routeParam } from './http.ts';
import type { IngestService } from './ingest-service.ts';
import type { SessionCatalog } from './session-catalog.ts';
import {
  buildPrompt,
  refuseLegacy,
  refuseRunning,
  toDetail,
  toListItem,
  toSessionView,
  writeContext,
} from './session-read.ts';
import type { SessionService } from './session-service.ts';

type ProjectStore = ReturnType<typeof createProjectStore>;

export type ReadingRouteDeps = {
  catalog: SessionCatalog;
  sessions: SessionService;
  ingest: IngestService;
  projects: ProjectStore;
  now: () => Date;
};

const CONTEXT_ONLY = new Set(['bug', 'flag', 'note', 'errors']);

function isContextOnly(value: string): value is ContextOnly {
  return CONTEXT_ONLY.has(value);
}

function readRename(body: unknown): RenameSessionRequest {
  if (!isRecord(body) || !isString(body.name)) {
    throw new TerrificError('USAGE', 'name must be a string.');
  }
  return { name: body.name };
}

function readContext(body: unknown): ContextRequest {
  if (body === undefined) return {};
  if (!isRecord(body)) throw new TerrificError('USAGE', 'Body must be an object.');
  if (body.only === undefined) return {};
  if (!Array.isArray(body.only)) {
    throw new TerrificError('USAGE', 'only must be an array.');
  }
  const only: ContextOnly[] = [];
  for (const item of body.only) {
    if (!isString(item) || !isContextOnly(item)) {
      throw new TerrificError('USAGE', 'only must contain bug, flag, note, or errors.');
    }
    only.push(item);
  }
  return { only };
}

function readPromptKind(raw: string | null): 'agent' | 'bugs' | 'full' {
  const kind = raw ?? 'agent';
  if (kind === 'agent' || kind === 'bugs' || kind === 'full') return kind;
  throw new TerrificError('USAGE', 'kind must be agent, bugs, or full.');
}

function readSettingsPatch(body: unknown): SettingsPatch {
  if (!isRecord(body)) throw new TerrificError('USAGE', 'Body must be an object.');
  const patch: SettingsPatch = {};
  if (Object.hasOwn(body, 'pinned')) {
    if (!Array.isArray(body.pinned) || body.pinned.some((item) => !isString(item))) {
      throw new TerrificError('USAGE', 'pinned must be an array of strings.');
    }
    patch.pinned = body.pinned;
  }
  if (Object.hasOwn(body, 'lastSetup')) {
    if (!isRecord(body.lastSetup)) {
      throw new TerrificError('USAGE', 'lastSetup must be an object.');
    }
    patch.lastSetup = body.lastSetup as SettingsPatch['lastSetup'];
  }
  if (Object.hasOwn(body, 'visibility')) {
    if (!isRecord(body.visibility)) {
      throw new TerrificError('USAGE', 'visibility must be an object.');
    }
    patch.visibility = body.visibility as SettingsPatch['visibility'];
  }
  return patch;
}

export function registerReadingRoutes(router: Router, deps: ReadingRouteDeps): void {
  const settings = new Map<string, ReturnType<typeof createSettingsStore>>();

  async function settingsFor(projectId: string) {
    const cached = settings.get(projectId);
    if (cached !== undefined) return cached;
    const project = await deps.projects.get(projectId);
    const store = createSettingsStore({ projectDir: project.dir });
    settings.set(projectId, store);
    return store;
  }

  router.route('GET', '/v1/projects/:projectId/sessions', async (ctx) => {
    const projectId = routeParam(ctx.params, 'projectId');
    const pinned = new Set((await (await settingsFor(projectId)).read()).pinned);
    const items = await Promise.all(
      (await deps.catalog.listForProject(projectId)).map((entry) =>
        toListItem(entry, pinned, deps.now),
      ),
    );
    ctx.send(200, items);
  });

  router.route('GET', '/v1/legacy/sessions', async (ctx) => {
    const items = await Promise.all(
      (await deps.catalog.listGlobalLegacy()).map((entry) =>
        toListItem(entry, new Set(), deps.now),
      ),
    );
    ctx.send(200, items);
  });

  router.route('GET', '/v1/sessions/:id', async (ctx) => {
    const entry = await deps.catalog.get(routeParam(ctx.params, 'id'));
    ctx.send(200, await toDetail(entry, deps.ingest));
  });

  router.route('GET', '/v1/sessions/:id/events', async (ctx) => {
    const entry = await deps.catalog.get(routeParam(ctx.params, 'id'));
    const query = parseEventQuery(ctx.query);
    ctx.send(200, queryEvents(await entry.loadEvents(), query));
  });

  router.route(
    'POST',
    '/v1/sessions/:id/context',
    async (ctx) => {
      const entry = await deps.catalog.get(routeParam(ctx.params, 'id'));
      ctx.send(200, await writeContext(entry, readContext(ctx.body).only));
    },
    { body: 'json' },
  );

  router.route('GET', '/v1/sessions/:id/prompt', async (ctx) => {
    const entry = await deps.catalog.get(routeParam(ctx.params, 'id'));
    ctx.send(200, await buildPrompt(entry, deps.ingest, readPromptKind(ctx.query.get('kind'))));
  });

  router.route(
    'PATCH',
    '/v1/sessions/:id',
    async (ctx) => {
      const id = routeParam(ctx.params, 'id');
      const entry = await deps.catalog.get(id);
      if (entry.legacy || entry.store === null) refuseLegacy();
      const { name } = readRename(ctx.body);
      const record = await entry.store.update(id, { name });
      deps.sessions.applyRecord(id, record);
      const next = await deps.catalog.get(id);
      ctx.send(200, await toSessionView(next, deps.ingest));
    },
    { body: 'json' },
  );

  router.route('DELETE', '/v1/sessions/:id', async (ctx) => {
    const id = routeParam(ctx.params, 'id');
    const entry = await deps.catalog.get(id);
    if (entry.legacy || entry.store === null) refuseLegacy();
    if (deps.sessions.isRecording(id)) refuseRunning();
    await entry.store.remove(id);
    ctx.send(200, { ok: true });
  });

  router.route('GET', '/v1/projects/:projectId/settings', async (ctx) => {
    const store = await settingsFor(routeParam(ctx.params, 'projectId'));
    ctx.send(200, await store.read());
  });

  router.route(
    'PATCH',
    '/v1/projects/:projectId/settings',
    async (ctx) => {
      const store = await settingsFor(routeParam(ctx.params, 'projectId'));
      ctx.send(200, await store.write(readSettingsPatch(ctx.body)));
    },
    { body: 'json' },
  );
}
