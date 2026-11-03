import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import { newEndpointToken, type RandomSource } from '../core/ids.ts';
import {
  type EndpointClosedReason,
  type EndpointRecord,
  type EndpointState,
  isEndpointRecord,
  isStoredEvent,
} from '../core/session.ts';
import { isEndpointName } from '../core/setup.ts';
import { appendJsonLine, readJsonFile, readJsonLines, writeJsonFile } from './json-file.ts';

export type EndpointPaths = {
  folder: string;
  endpointFile: string;
  eventsFile: string;
};

type EndpointStoreOptions = {
  projectDir: string;
  now: () => Date;
  random: RandomSource;
};

function endpointPaths(folder: string): EndpointPaths {
  return {
    folder,
    endpointFile: join(folder, 'endpoint.json'),
    eventsFile: join(folder, 'events.jsonl'),
  };
}

function assertInsideIngest(ingestDir: string, folder: string): void {
  const rel = relative(resolve(ingestDir), resolve(folder));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new TerrificError('INTERNAL', 'Endpoint folder is outside the ingest directory.');
  }
}

function requireName(name: string): void {
  if (!isEndpointName(name)) {
    throw new TerrificError(
      'USAGE',
      'Endpoint names use lowercase letters, digits and hyphens, up to 32 characters.',
    );
  }
}

export function createEndpointStore(options: EndpointStoreOptions) {
  const ingestDir = join(options.projectDir, 'ingest');

  function pathsFor(name: string): EndpointPaths {
    return endpointPaths(join(ingestDir, name));
  }

  async function readRecord(name: string): Promise<EndpointRecord | null> {
    return readJsonFile(pathsFor(name).endpointFile, isEndpointRecord);
  }

  async function requireRecord(name: string): Promise<EndpointRecord> {
    const record = await readRecord(name);
    if (record === null) {
      throw new TerrificError('NOT_FOUND', `Endpoint "${name}" was not found.`);
    }
    return record;
  }

  async function create(name: string): Promise<EndpointRecord> {
    requireName(name);
    if ((await readRecord(name)) !== null) {
      throw new TerrificError('CONFLICT', `An endpoint named "${name}" already exists.`);
    }
    const now = options.now().toISOString();
    const record: EndpointRecord = {
      version: 1,
      name,
      token: newEndpointToken(options.random),
      state: 'open',
      closedReason: null,
      createdAt: now,
      lastEventAt: null,
      eventCount: 0,
    };
    const paths = pathsFor(name);
    await writeJsonFile(paths.endpointFile, record);
    await writeFile(paths.eventsFile, '');
    return record;
  }

  async function get(name: string): Promise<EndpointRecord> {
    return requireRecord(name);
  }

  async function list(): Promise<EndpointRecord[]> {
    let names: string[];
    try {
      names = await readdir(ingestDir);
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
    names.sort();
    const records: EndpointRecord[] = [];
    for (const name of names) {
      let record: EndpointRecord | null;
      try {
        record = await readRecord(name);
      } catch {
        continue;
      }
      if (record !== null) records.push(record);
    }
    return records;
  }

  async function setState(
    name: string,
    state: EndpointState,
    reason: EndpointClosedReason | null,
  ): Promise<EndpointRecord> {
    const record = await requireRecord(name);
    const next: EndpointRecord = {
      ...record,
      state,
      closedReason: state === 'open' ? null : (reason ?? 'manual'),
    };
    await writeJsonFile(pathsFor(name).endpointFile, next);
    return next;
  }

  async function renameEndpoint(name: string, next: string): Promise<EndpointRecord> {
    requireName(next);
    if (name === next) return requireRecord(name);
    const record = await requireRecord(name);
    if ((await readRecord(next)) !== null) {
      throw new TerrificError('CONFLICT', `An endpoint named "${next}" already exists.`);
    }
    const from = pathsFor(name).folder;
    const to = pathsFor(next).folder;
    assertInsideIngest(ingestDir, from);
    assertInsideIngest(ingestDir, to);
    await rename(from, to);
    const updated: EndpointRecord = { ...record, name: next };
    await writeJsonFile(pathsFor(next).endpointFile, updated);
    return updated;
  }

  async function remove(name: string): Promise<void> {
    await requireRecord(name);
    const folder = pathsFor(name).folder;
    assertInsideIngest(ingestDir, folder);
    await rm(folder, { recursive: true, force: true });
  }

  async function appendEvent(name: string, event: TerrificEvent): Promise<EndpointRecord> {
    const record = await requireRecord(name);
    await appendJsonLine(pathsFor(name).eventsFile, event);
    const next: EndpointRecord = {
      ...record,
      lastEventAt: event.at,
      eventCount: record.eventCount + 1,
    };
    await writeJsonFile(pathsFor(name).endpointFile, next);
    return next;
  }

  async function readEvents(
    name: string,
    query?: { limit?: number },
  ): Promise<{ events: TerrificEvent[]; skipped: number }> {
    await requireRecord(name);
    const file = pathsFor(name).eventsFile;
    const { items, skipped } = await readJsonLines(file, isStoredEvent);
    const limit = query?.limit;
    if (limit === undefined) return { events: items, skipped };
    return { events: items.slice(Math.max(0, items.length - limit)), skipped };
  }

  async function findByToken(token: string): Promise<EndpointRecord | null> {
    for (const record of await list()) {
      if (record.token === token) return record;
    }
    return null;
  }

  async function closeIdle(maxIdleMs: number): Promise<string[]> {
    const cutoff = options.now().getTime() - maxIdleMs;
    const closed: string[] = [];
    for (const record of await list()) {
      if (record.state !== 'open') continue;
      const stamp = record.lastEventAt ?? record.createdAt;
      if (Date.parse(stamp) >= cutoff) continue;
      await setState(record.name, 'closed', 'idle');
      closed.push(record.name);
    }
    return closed;
  }

  return {
    create,
    get,
    list,
    setState,
    rename: renameEndpoint,
    remove,
    appendEvent,
    readEvents,
    findByToken,
    closeIdle,
  };
}
