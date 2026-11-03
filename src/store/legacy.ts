import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import { sameProject } from '../core/project-path.ts';
import type { SessionStatus, SessionSummaryInfo } from '../core/session.ts';
import type { SessionSetup } from '../core/setup.ts';
import { isRecord, isString } from '../core/validate.ts';
import { convertLegacyEvents } from './legacy-events.ts';
import { leadingJsonValue } from './legacy-json.ts';

export type LegacyStore = {
  kind: 'global' | 'workspace';
  sessionsDir: string;
  projectPath: string | null;
};

export type LegacySessionInfo = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  folder: string;
  store: LegacyStore;
  hasContext: boolean;
};

export type LegacySessionRead = {
  summary: SessionSummaryInfo;
  events: TerrificEvent[];
  skipped: number;
  recovered: boolean;
  contextFile: string | null;
};

type Meta = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  startTime: number;
  config: Record<string, unknown>;
};

function dropTerrific(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('/.terrific') || lower.endsWith('\\.terrific')) {
    return trimmed.slice(0, -10);
  }
  return trimmed;
}

function mapStatus(value: unknown): SessionStatus | null {
  if (value === 'completed') return 'stopped';
  if (value === 'recording' || value === 'paused' || value === 'interrupted') return 'interrupted';
  return null;
}

function readMeta(value: unknown): Meta | null {
  if (!isRecord(value) || !isString(value.id) || typeof value.startTime !== 'number') return null;
  const status = mapStatus(value.status);
  if (status === null) return null;
  const config = isRecord(value.config) ? value.config : {};
  const created = isString(value.createdAt) ? new Date(value.createdAt) : new Date(value.startTime);
  if (Number.isNaN(created.getTime())) return null;
  const named = isString(value.name) ? value.name : isString(config.name) ? config.name : null;
  return {
    id: value.id,
    name: named && named.trim() !== '' ? named : null,
    status,
    startedAt: created.toISOString(),
    startTime: value.startTime,
    config,
  };
}

function setupFrom(config: Record<string, unknown>): SessionSetup {
  return {
    target: config.sessionType === 'debug_gateway' ? 'none' : 'browser',
    url: isString(config.initialUrl) ? config.initialUrl : '',
    profile: 'clean',
    record: {
      actions: config.recordActions === true,
      network: config.recordNetwork === true,
      console: config.recordConsole === true,
    },
    endpoint: null,
  };
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function parseJsonl(text: string): unknown[] {
  const items: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      // A crash can leave a truncated last line; earlier lines stay usable.
    }
  }
  return items;
}

type EventsJsonRead =
  | { status: 'ok'; raw: unknown[]; recovered: boolean }
  | { status: 'missing' }
  | { status: 'bad' };

async function readEventsJson(folder: string): Promise<EventsJsonRead> {
  let text: string;
  try {
    text = await readFile(join(folder, 'events.json'), 'utf8');
  } catch {
    return { status: 'missing' };
  }
  try {
    const value = JSON.parse(text);
    return Array.isArray(value)
      ? { status: 'ok', raw: value, recovered: false }
      : { status: 'missing' };
  } catch {
    const leading = leadingJsonValue(text);
    if (leading === null) return { status: 'bad' };
    try {
      const value = JSON.parse(leading);
      return Array.isArray(value)
        ? { status: 'ok', raw: value, recovered: true }
        : { status: 'bad' };
    } catch {
      return { status: 'bad' };
    }
  }
}

async function readEventsJsonl(folder: string): Promise<unknown[] | undefined> {
  try {
    return parseJsonl(await readFile(join(folder, 'events.jsonl'), 'utf8'));
  } catch {
    return undefined;
  }
}

async function readEvents(
  folder: string,
  completed: boolean,
): Promise<{ raw: unknown[]; recovered: boolean; unreadable: boolean }> {
  // Completed sessions publish events.json; anything still open only has the append log.
  if (completed) {
    const preferred = await readEventsJson(folder);
    if (preferred.status === 'ok') {
      return { raw: preferred.raw, recovered: preferred.recovered, unreadable: false };
    }
    const fallback = await readEventsJsonl(folder);
    if (fallback !== undefined) return { raw: fallback, recovered: false, unreadable: false };
    return { raw: [], recovered: false, unreadable: preferred.status === 'bad' };
  }
  const preferred = await readEventsJsonl(folder);
  if (preferred !== undefined) return { raw: preferred, recovered: false, unreadable: false };
  const fallback = await readEventsJson(folder);
  if (fallback.status === 'ok') {
    return { raw: fallback.raw, recovered: fallback.recovered, unreadable: false };
  }
  return { raw: [], recovered: false, unreadable: fallback.status === 'bad' };
}

async function listContext(
  folder: string,
): Promise<{ hasContext: boolean; newest: string | null }> {
  let files: string[];
  try {
    files = (await readdir(folder)).filter((name) => name.endsWith('-context.txt'));
  } catch {
    return { hasContext: false, newest: null };
  }
  if (files.length === 0) return { hasContext: false, newest: null };
  const ranked: { name: string; mtime: number }[] = [];
  for (const name of files) {
    try {
      ranked.push({ name, mtime: (await stat(join(folder, name))).mtimeMs });
    } catch {
      ranked.push({ name, mtime: 0 });
    }
  }
  ranked.sort((a, b) => {
    if (a.mtime !== b.mtime) return b.mtime - a.mtime;
    return a.name < b.name ? 1 : -1;
  });
  const first = ranked[0];
  if (!first) return { hasContext: false, newest: null };
  return { hasContext: true, newest: join(folder, first.name) };
}

async function workspaces(dataRoot: string): Promise<LegacyStore[]> {
  const parsed = await readJson(join(dataRoot, 'workspaces.json'));
  if (!isRecord(parsed) || !isRecord(parsed.workspaces)) return [];
  const stores: LegacyStore[] = [];
  const seen = new Set<string>();
  for (const item of Object.values(parsed.workspaces)) {
    if (!isRecord(item) || !isString(item.path)) continue;
    const sessionsDir = join(item.path, 'sessions');
    if (seen.has(sessionsDir.toLowerCase()) || !(await isDir(sessionsDir))) continue;
    seen.add(sessionsDir.toLowerCase());
    stores.push({ kind: 'workspace', sessionsDir, projectPath: dropTerrific(item.path) });
  }
  return stores;
}

export function createLegacyReader(options: { dataRoot: string }) {
  async function listStores(): Promise<LegacyStore[]> {
    const stores: LegacyStore[] = [];
    const globalDir = join(options.dataRoot, 'sessions');
    if (await isDir(globalDir)) {
      stores.push({ kind: 'global', sessionsDir: globalDir, projectPath: null });
    }
    stores.push(...(await workspaces(options.dataRoot)));
    return stores;
  }

  async function listSessions(store: LegacyStore): Promise<LegacySessionInfo[]> {
    let names: string[];
    try {
      names = await readdir(store.sessionsDir);
    } catch {
      return [];
    }
    const listed: LegacySessionInfo[] = [];
    for (const name of names) {
      const folder = join(store.sessionsDir, name);
      if (!(await isDir(folder))) continue;
      const meta = readMeta(await readJson(join(folder, 'metadata.json')));
      if (!meta) continue;
      const context = await listContext(folder);
      listed.push({
        id: meta.id,
        name: meta.name,
        status: meta.status,
        startedAt: meta.startedAt,
        folder,
        store,
        hasContext: context.hasContext,
      });
    }
    listed.sort((a, b) => {
      if (a.startedAt === b.startedAt) return 0;
      return a.startedAt < b.startedAt ? 1 : -1;
    });
    return listed;
  }

  async function readSession(info: LegacySessionInfo): Promise<LegacySessionRead> {
    const meta = readMeta(await readJson(join(info.folder, 'metadata.json')));
    if (!meta) {
      throw new TerrificError('NOT_FOUND', `Legacy session "${info.id}" has no readable metadata.`);
    }
    const loaded = await readEvents(info.folder, info.status === 'stopped');
    const startMs = new Date(meta.startedAt).getTime();
    const converted = convertLegacyEvents(
      loaded.raw,
      Number.isNaN(startMs) ? meta.startTime : startMs,
    );
    const last = converted.events[converted.events.length - 1];
    const context = await listContext(info.folder);
    const summary: SessionSummaryInfo = {
      id: meta.id,
      name: meta.name,
      status: meta.status,
      startedAt: meta.startedAt,
      stoppedAt: meta.status === 'stopped' ? (last?.at ?? meta.startedAt) : null,
      projectPath: info.store.projectPath ?? '',
      setup: setupFrom(meta.config),
      legacy: true,
    };
    return {
      summary,
      events: converted.events,
      skipped: converted.skipped + (loaded.unreadable ? 1 : 0),
      recovered: loaded.recovered,
      contextFile: context.newest,
    };
  }

  async function forProject(projectPath: string): Promise<LegacySessionInfo[]> {
    const stores = (await listStores()).filter((store) => {
      if (store.kind !== 'workspace' || store.projectPath === null) return false;
      return sameProject(store.projectPath, projectPath);
    });
    const sessions: LegacySessionInfo[] = [];
    for (const store of stores) sessions.push(...(await listSessions(store)));
    sessions.sort((a, b) => {
      if (a.startedAt === b.startedAt) return 0;
      return a.startedAt < b.startedAt ? 1 : -1;
    });
    return sessions;
  }

  return { listStores, listSessions, readSession, forProject };
}
