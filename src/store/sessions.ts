import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import {
  newSessionId,
  parseSessionFolderName,
  type RandomSource,
  sessionFolderName,
} from '../core/ids.ts';
import {
  isSessionRecord,
  isStoredEvent,
  type SessionRecord,
  type SessionStatus,
} from '../core/session.ts';
import { copySetup, type SessionSetup } from '../core/setup.ts';
import { appendJsonLines, readJsonFile, readJsonLines, writeJsonFile } from './json-file.ts';

export type SessionPaths = {
  folder: string;
  sessionFile: string;
  eventsFile: string;
  contextFile: string;
  screenshotsDir: string;
};

export type CreateSessionInput = {
  name: string | null;
  setup: SessionSetup;
  endpoint: { name: string; token: string } | null;
  projectId: string;
};

type SessionStoreOptions = {
  projectDir: string;
  now: () => Date;
  random: RandomSource;
};

function sessionPaths(folder: string): SessionPaths {
  return {
    folder,
    sessionFile: join(folder, 'session.json'),
    eventsFile: join(folder, 'events.jsonl'),
    contextFile: join(folder, 'context.txt'),
    screenshotsDir: join(folder, 'screenshots'),
  };
}

function assertInsideSessions(sessionsDir: string, folder: string): void {
  const rel = relative(resolve(sessionsDir), resolve(folder));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new TerrificError('INTERNAL', 'Session folder is outside the sessions directory.');
  }
}

export function createSessionStore(options: SessionStoreOptions) {
  const sessionsDir = join(options.projectDir, 'sessions');
  const folders = new Map<string, string>();

  function pathsForFolder(folderName: string): SessionPaths {
    return sessionPaths(join(sessionsDir, folderName));
  }

  async function rememberFromDisk(): Promise<SessionRecord[]> {
    folders.clear();
    let names: string[];
    try {
      names = await readdir(sessionsDir);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
    const records: { record: SessionRecord; folder: string }[] = [];
    names.sort();
    names.reverse();
    for (const name of names) {
      if (parseSessionFolderName(name) === null) continue;
      let record: SessionRecord | null;
      try {
        record = await readJsonFile(pathsForFolder(name).sessionFile, isSessionRecord);
      } catch {
        continue;
      }
      if (record === null) continue;
      folders.set(record.id, name);
      records.push({ record, folder: name });
    }
    return records.map((item) => item.record);
  }

  async function folderName(sessionId: string): Promise<string> {
    const known = folders.get(sessionId);
    if (known !== undefined) return known;
    await rememberFromDisk();
    const found = folders.get(sessionId);
    if (found === undefined) {
      throw new TerrificError('NOT_FOUND', `Session "${sessionId}" was not found.`);
    }
    return found;
  }

  async function readRecord(sessionId: string): Promise<SessionRecord> {
    const name = await folderName(sessionId);
    const record = await readJsonFile(pathsForFolder(name).sessionFile, isSessionRecord);
    if (record === null) {
      folders.delete(sessionId);
      throw new TerrificError('NOT_FOUND', `Session "${sessionId}" was not found.`);
    }
    return record;
  }

  async function create(
    input: CreateSessionInput,
  ): Promise<{ record: SessionRecord; folder: string }> {
    const started = options.now();
    const id = newSessionId(options.random);
    const folder = sessionFolderName(id, started);
    const dir = join(sessionsDir, folder);
    const record: SessionRecord = {
      version: 1,
      id,
      name: input.name,
      status: 'recording',
      startedAt: started.toISOString(),
      stoppedAt: null,
      projectId: input.projectId,
      setup: copySetup(input.setup),
      endpoint: input.endpoint === null ? null : { ...input.endpoint },
    };
    const paths = sessionPaths(dir);
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeJsonFile(paths.sessionFile, record);
    await writeFile(paths.eventsFile, '');
    folders.set(id, folder);
    return { record, folder: dir };
  }

  async function appendEvents(sessionId: string, events: TerrificEvent[]): Promise<void> {
    const name = await folderName(sessionId);
    await appendJsonLines(pathsForFolder(name).eventsFile, events);
  }

  async function readEvents(
    sessionId: string,
  ): Promise<{ events: TerrificEvent[]; skipped: number }> {
    const name = await folderName(sessionId);
    const file = pathsForFolder(name).eventsFile;
    const { items, skipped } = await readJsonLines(file, isStoredEvent);
    return { events: items, skipped };
  }

  async function update(
    sessionId: string,
    patch: Partial<Pick<SessionRecord, 'name' | 'status' | 'stoppedAt'>>,
  ): Promise<SessionRecord> {
    const name = await folderName(sessionId);
    const record = await readRecord(sessionId);
    const next: SessionRecord = { ...record, ...patch };
    await writeJsonFile(pathsForFolder(name).sessionFile, next);
    return next;
  }

  async function get(id: string): Promise<SessionRecord> {
    return readRecord(id);
  }

  async function list(): Promise<SessionRecord[]> {
    return rememberFromDisk();
  }

  async function remove(id: string): Promise<void> {
    const name = await folderName(id);
    const folder = join(sessionsDir, name);
    assertInsideSessions(sessionsDir, folder);
    await rm(folder, { recursive: true, force: true });
    folders.delete(id);
  }

  function paths(id: string): SessionPaths {
    const name = folders.get(id);
    if (name === undefined) {
      throw new TerrificError('NOT_FOUND', `Session "${id}" was not found.`);
    }
    return pathsForFolder(name);
  }

  async function markInterrupted(): Promise<string[]> {
    const records = await rememberFromDisk();
    const ids: string[] = [];
    for (const record of records) {
      if (record.status !== 'recording') continue;
      const status: SessionStatus = 'interrupted';
      await update(record.id, { status });
      ids.push(record.id);
    }
    return ids;
  }

  return { create, appendEvents, readEvents, update, get, list, remove, paths, markInterrupted };
}
