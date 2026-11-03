import { deepEqual, equal, match } from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { isTerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import { createEndpointStore } from './endpoints.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-'));
  dirs.push(dir);
  return dir;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function queueRandom(ids: string[]): RandomSource {
  const queue = ids.flatMap((id) => [...id].map((ch) => ALPHABET.indexOf(ch)));
  let offset = 0;
  return (n) => {
    const slice = Uint8Array.from(queue.slice(offset, offset + n));
    offset += n;
    return slice;
  };
}

const TOKEN_A = 'a'.repeat(24);
const TOKEN_B = 'b'.repeat(24);

function store(projectDir: string, now: string, ids: string[] = [TOKEN_A]) {
  return createEndpointStore({
    projectDir,
    now: () => new Date(now),
    random: queueRandom(ids),
  });
}

function event(seq: number, at = '2026-01-01T00:00:00.000Z'): TerrificEvent {
  return {
    id: `ev_${seq}`,
    seq,
    at,
    t: seq,
    kind: 'ingest',
    endpoint: 'app',
    message: 'x',
    level: 'info',
  };
}

test('create writes ingest/<name> and rejects a second create of the same name', async () => {
  const projectDir = await tempDir();
  const endpoints = store(projectDir, '2026-01-01T00:00:00.000Z');
  const created = await endpoints.create('app');
  equal(created.state, 'open');
  match(created.token, /^ing_a{24}$/);
  await access(join(projectDir, 'ingest', 'app', 'endpoint.json'));
  await access(join(projectDir, 'ingest', 'app', 'events.jsonl'));
  try {
    await endpoints.create('app');
    throw new Error('expected CONFLICT');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'CONFLICT');
  }
});

test('create rejects an invalid name', async () => {
  const projectDir = await tempDir();
  try {
    await store(projectDir, '2026-01-01T00:00:00.000Z').create('App');
    throw new Error('expected USAGE');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'USAGE');
  }
});

test('rename keeps the token and findByToken still resolves it', async () => {
  const projectDir = await tempDir();
  const endpoints = store(projectDir, '2026-01-01T00:00:00.000Z');
  const created = await endpoints.create('app');
  const renamed = await endpoints.rename('app', 'api');
  equal(renamed.name, 'api');
  equal(renamed.token, created.token);
  equal((await endpoints.findByToken(created.token))?.name, 'api');
  try {
    await endpoints.get('app');
    throw new Error('expected NOT_FOUND');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'NOT_FOUND');
  }
});

test('appendEvent updates lastEventAt and eventCount; readEvents can limit', async () => {
  const projectDir = await tempDir();
  const endpoints = store(projectDir, '2026-01-01T00:00:00.000Z');
  await endpoints.create('app');
  await endpoints.appendEvent('app', event(1, '2026-01-01T01:00:00.000Z'));
  const after = await endpoints.appendEvent('app', event(2, '2026-01-01T02:00:00.000Z'));
  equal(after.eventCount, 2);
  equal(after.lastEventAt, '2026-01-01T02:00:00.000Z');
  const all = await endpoints.readEvents('app');
  equal(all.events.length, 2);
  const tail = await endpoints.readEvents('app', { limit: 1 });
  equal(tail.events.length, 1);
  equal(tail.events[0]?.seq, 2);
});

test('setState reopens with the same URL token and closeIdle uses lastEventAt or createdAt', async () => {
  const projectDir = await tempDir();
  let now = '2026-01-01T00:00:00.000Z';
  const endpoints = createEndpointStore({
    projectDir,
    now: () => new Date(now),
    random: queueRandom([TOKEN_A, TOKEN_B]),
  });
  const idle = await endpoints.create('idle');
  now = '2026-01-02T00:00:00.000Z';
  await endpoints.create('hot');
  await endpoints.appendEvent('hot', event(1, '2026-01-01T23:30:00.000Z'));
  const closed = await endpoints.closeIdle(60 * 60 * 1000);
  deepEqual(closed, ['idle']);
  equal((await endpoints.get('idle')).closedReason, 'idle');
  equal((await endpoints.get('hot')).state, 'open');
  const reopened = await endpoints.setState('idle', 'open', null);
  equal(reopened.state, 'open');
  equal(reopened.closedReason, null);
  equal(reopened.token, idle.token);
});

test('remove deletes the folder so the token stops resolving', async () => {
  const projectDir = await tempDir();
  const endpoints = store(projectDir, '2026-01-01T00:00:00.000Z');
  const created = await endpoints.create('app');
  await endpoints.remove('app');
  equal(await endpoints.findByToken(created.token), null);
});
