import type { HealthView, MarkRequest, StartSessionRequest, StatusView } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { isSessionSetup } from '../core/session.ts';
import { isRecord, isString } from '../core/validate.ts';
import type { createProjectStore } from '../store/projects.ts';
import { type Router, routeParam } from './http.ts';
import type { IngestService } from './ingest-service.ts';
import type { SessionService } from './session-service.ts';
import { type StreamHub, sessionTopic } from './stream-hub.ts';

type ProjectStore = ReturnType<typeof createProjectStore>;

export type SessionRouteDeps = {
  sessions: SessionService;
  ingest: IngestService;
  projects: ProjectStore;
  hub: StreamHub;
  appVersion: string;
  pid: number;
  getPort: () => number;
  startedAt: string;
};

function readStart(body: unknown): StartSessionRequest {
  if (!isRecord(body) || !isSessionSetup(body.setup)) {
    throw new TerrificError('USAGE', 'setup must be a complete SessionSetup.');
  }
  if (!(body.name === null || isString(body.name))) {
    throw new TerrificError('USAGE', 'name must be a string or null.');
  }
  return { setup: body.setup, name: body.name };
}

function readStopName(body: unknown): string | undefined {
  if (!isRecord(body) || !Object.hasOwn(body, 'name')) return undefined;
  if (!(body.name === null || isString(body.name))) {
    throw new TerrificError('USAGE', 'name must be a string or null.');
  }
  return body.name === null ? undefined : body.name;
}

function readMark(body: unknown): MarkRequest {
  if (!isRecord(body)) {
    throw new TerrificError('USAGE', 'Body must be an object.');
  }
  if (body.kind !== 'note' && body.kind !== 'bug' && body.kind !== 'flag') {
    throw new TerrificError('USAGE', 'kind must be note, bug, or flag.');
  }
  if (!(body.text === null || isString(body.text))) {
    throw new TerrificError('USAGE', 'text must be a string or null.');
  }
  if (body.kind === 'note' && (body.text === null || body.text.trim() === '')) {
    throw new TerrificError('USAGE', 'Note text is required.');
  }
  const request: MarkRequest = { kind: body.kind, text: body.text };
  if (body.author !== undefined) {
    if (body.author !== 'tester' && body.author !== 'agent') {
      throw new TerrificError('USAGE', 'author must be tester or agent.');
    }
    request.author = body.author;
  }
  return request;
}

export function registerSessionRoutes(router: Router, deps: SessionRouteDeps): void {
  router.route(
    'POST',
    '/v1/projects/:projectId/sessions',
    async (ctx) => {
      const projectId = routeParam(ctx.params, 'projectId');
      ctx.send(201, await deps.sessions.start(projectId, readStart(ctx.body)));
    },
    { body: 'json' },
  );

  router.route(
    'POST',
    '/v1/sessions/:id/stop',
    async (ctx) => {
      ctx.send(200, await deps.sessions.stop(routeParam(ctx.params, 'id'), readStopName(ctx.body)));
    },
    { body: 'json' },
  );

  router.route(
    'POST',
    '/v1/sessions/:id/marks',
    async (ctx) => {
      ctx.send(200, await deps.sessions.mark(routeParam(ctx.params, 'id'), readMark(ctx.body)));
    },
    { body: 'json' },
  );

  router.route('POST', '/v1/sessions/:id/screenshot', async (ctx) => {
    ctx.send(200, await deps.sessions.screenshot(routeParam(ctx.params, 'id')));
  });

  router.route('POST', '/v1/sessions/:id/snapshot', async (ctx) => {
    ctx.send(200, await deps.sessions.snapshot(routeParam(ctx.params, 'id')));
  });

  router.route('GET', '/v1/sessions/:id/stream', async (ctx) => {
    const id = routeParam(ctx.params, 'id');
    await deps.sessions.get(id);
    const sse = ctx.openSse();
    const unsubscribe = deps.hub.subscribe(sessionTopic(id), (message) => {
      sse.send('event', message);
    });
    sse.onClose(unsubscribe);
  });

  router.route('GET', '/v1/status', async (ctx) => {
    const sessions = await deps.sessions.running();
    const endpoints: StatusView['endpoints'] = [];
    for (const project of await deps.projects.list()) {
      for (const endpoint of await deps.ingest.list(project.id)) {
        if (endpoint.state === 'open') endpoints.push({ ...endpoint, projectId: project.id });
      }
    }
    const daemon: HealthView = {
      appVersion: deps.appVersion,
      pid: deps.pid,
      port: deps.getPort(),
      startedAt: deps.startedAt,
    };
    ctx.send(200, { daemon, sessions, endpoints } satisfies StatusView);
  });
}
