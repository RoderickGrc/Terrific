import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { isTerrificError, TerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import { sameProject } from '../core/project-path.ts';
import { type SessionRecord, type SessionSummaryInfo, toSummaryInfo } from '../core/session.ts';
import { createLegacyReader, type LegacySessionInfo } from '../store/legacy.ts';
import type { createProjectStore, ProjectInfo } from '../store/projects.ts';
import { createSessionStore } from '../store/sessions.ts';
import type { SessionStore } from './session-live.ts';
import type { SessionService } from './session-service.ts';

type ProjectStore = ReturnType<typeof createProjectStore>;
type LegacyReader = ReturnType<typeof createLegacyReader>;

export type CatalogPaths = {
  folder: string;
  eventsFile: string;
  contextFile: string;
  legacyContextFile: string | null;
  screenshotsDir: string;
};

export type CatalogEntry = {
  id: string;
  summary: SessionSummaryInfo;
  projectId: string | null;
  project: ProjectInfo | null;
  legacy: boolean;
  record: SessionRecord | null;
  store: SessionStore | null;
  paths: CatalogPaths;
  loadEvents: () => Promise<TerrificEvent[]>;
};

export type SessionCatalog = {
  get(id: string): Promise<CatalogEntry>;
  listForProject(projectId: string): Promise<CatalogEntry[]>;
  listGlobalLegacy(): Promise<CatalogEntry[]>;
  refresh(): Promise<void>;
};

type LegacyRow = {
  info: LegacySessionInfo;
  projectId: string | null;
  project: ProjectInfo | null;
};

function newestFirst(a: CatalogEntry, b: CatalogEntry): number {
  if (a.summary.startedAt === b.summary.startedAt) return 0;
  return a.summary.startedAt < b.summary.startedAt ? 1 : -1;
}

async function existingFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function legacyEventsFile(folder: string): Promise<string> {
  const json = join(folder, 'events.json');
  if (await existingFile(json)) return json;
  return join(folder, 'events.jsonl');
}

function cacheContextFile(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'cache', 'legacy', sessionId, 'context.txt');
}

export function createSessionCatalog(options: {
  dataRoot: string;
  projects: ProjectStore;
  sessions: SessionService;
  now: () => Date;
  random: RandomSource;
}): SessionCatalog {
  const stores = new Map<string, SessionStore>();
  const reader: LegacyReader = createLegacyReader({ dataRoot: options.dataRoot });
  let legacyRows: LegacyRow[] | null = null;

  async function storeFor(project: ProjectInfo): Promise<SessionStore> {
    const cached = stores.get(project.id);
    if (cached !== undefined) return cached;
    const store = createSessionStore({
      projectDir: project.dir,
      now: options.now,
      random: options.random,
    });
    stores.set(project.id, store);
    return store;
  }

  async function refresh(): Promise<void> {
    const projects = await options.projects.list();
    const rows: LegacyRow[] = [];
    for (const store of await reader.listStores()) {
      const workspacePath = store.projectPath;
      const project =
        store.kind === 'workspace' && workspacePath !== null
          ? (projects.find((item) => sameProject(item.cwd, workspacePath)) ?? null)
          : null;
      const projectId = project === null ? null : project.id;
      for (const info of await reader.listSessions(store)) {
        rows.push({
          info,
          projectId: store.kind === 'global' ? null : projectId,
          project: store.kind === 'global' ? null : project,
        });
      }
    }
    legacyRows = rows;
  }

  async function ensureLegacy(): Promise<LegacyRow[]> {
    if (legacyRows === null) await refresh();
    return legacyRows ?? [];
  }

  async function fromNew(
    record: SessionRecord,
    project: ProjectInfo,
    store: SessionStore,
  ): Promise<CatalogEntry> {
    await store.get(record.id);
    const paths = store.paths(record.id);
    return {
      id: record.id,
      summary: toSummaryInfo(record, project.cwd),
      projectId: project.id,
      project,
      legacy: false,
      record,
      store,
      paths: {
        folder: paths.folder,
        eventsFile: paths.eventsFile,
        contextFile: paths.contextFile,
        legacyContextFile: null,
        screenshotsDir: paths.screenshotsDir,
      },
      async loadEvents() {
        const { events } = await store.readEvents(record.id);
        return events;
      },
    };
  }

  async function fromLegacy(row: LegacyRow): Promise<CatalogEntry> {
    const read = await reader.readSession(row.info);
    const contextFile = cacheContextFile(options.dataRoot, row.info.id);
    const eventsFile = await legacyEventsFile(row.info.folder);
    return {
      id: row.info.id,
      summary: read.summary,
      projectId: row.projectId,
      project: row.project,
      legacy: true,
      record: null,
      store: null,
      paths: {
        folder: row.info.folder,
        eventsFile,
        contextFile,
        legacyContextFile: read.contextFile,
        screenshotsDir: join(row.info.folder, 'screenshots'),
      },
      async loadEvents() {
        return read.events;
      },
    };
  }

  async function lookup(id: string): Promise<CatalogEntry | null> {
    const live = options.sessions.findLive(id);
    if (live !== null) return fromNew(live.record, live.project, live.store);
    for (const project of await options.projects.list()) {
      const store = await storeFor(project);
      try {
        const record = await store.get(id);
        return fromNew(record, project, store);
      } catch (error) {
        if (!isTerrificError(error) || error.code !== 'NOT_FOUND') throw error;
      }
    }
    const rows = await ensureLegacy();
    const row = rows.find((item) => item.info.id === id);
    if (row === undefined) return null;
    return fromLegacy(row);
  }

  async function get(id: string): Promise<CatalogEntry> {
    const found = await lookup(id);
    if (found !== null) return found;
    await refresh();
    const again = await lookup(id);
    if (again !== null) return again;
    throw new TerrificError('NOT_FOUND', `Session "${id}" was not found.`);
  }

  async function listForProject(projectId: string): Promise<CatalogEntry[]> {
    const project = await options.projects.get(projectId);
    const store = await storeFor(project);
    const listed: CatalogEntry[] = [];
    for (const record of await store.list()) {
      const live = options.sessions.findLive(record.id);
      listed.push(await fromNew(live?.record ?? record, project, store));
    }
    await refresh();
    for (const row of await ensureLegacy()) {
      if (row.projectId !== projectId) continue;
      listed.push(await fromLegacy(row));
    }
    listed.sort(newestFirst);
    return listed;
  }

  async function listGlobalLegacy(): Promise<CatalogEntry[]> {
    await refresh();
    const listed: CatalogEntry[] = [];
    for (const row of await ensureLegacy()) {
      if (row.info.store.kind !== 'global') continue;
      listed.push(await fromLegacy(row));
    }
    listed.sort(newestFirst);
    return listed;
  }

  return { get, listForProject, listGlobalLegacy, refresh };
}
