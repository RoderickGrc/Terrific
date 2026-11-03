import { deepEqual, equal } from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { isTerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import type { SessionSetup } from '../core/setup.ts';
import { createSessionStore } from './sessions.ts';

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

const setup: SessionSetup = {
  target: 'browser',
  url: 'http://app.test',
  profile: 'clean',
  record: { actions: true, network: true, console: true },
  endpoint: 'app',
};

function event(seq: number): TerrificEvent {
  return {
    id: `ev_${seq}`,
    seq,
    at: '2026-01-01T00:00:00.000Z',
    t: seq,
    kind: 'lifecycle',
    state: 'started',
  };
}

test('create writes session.json, an empty events.jsonl, and the screenshots dir', async () => {
  const projectDir = await tempDir();
  const sessions = createSessionStore({
    projectDir,
    now: () => new Date('2026-11-03T02:14:08.000Z'),
    random: queueRandom(['x7ootg10qc']),
  });
  const created = await sessions.create({
    name: 'login',
    setup,
    endpoint: { name: 'app', token: 'ing_aaaaaaaaaaaaaaaaaaaaaaaa' },
    projectId: 'k2m8q4zx',
  });
  equal(created.record.id, 'x7ootg10qc');
  equal(created.record.status, 'recording');
  equal(created.folder, join(projectDir, 'sessions', '2026-11-03_02-14-08_x7ootg10qc'));
  await access(join(created.folder, 'session.json'));
  await access(join(created.folder, 'events.jsonl'));
  await access(join(created.folder, 'screenshots'));
  const paths = sessions.paths(created.record.id);
  equal(paths.contextFile, join(created.folder, 'context.txt'));
});

test('list is newest first and skips folders without a valid session.json', async () => {
  const projectDir = await tempDir();
  let now = '2026-11-03T02:14:08.000Z';
  const sessions = createSessionStore({
    projectDir,
    now: () => new Date(now),
    random: queueRandom(['aaaaaaaaaa', 'bbbbbbbbbb']),
  });
  await sessions.create({ name: 'old', setup, endpoint: null, projectId: 'k2m8q4zx' });
  now = '2026-11-03T02:14:09.000Z';
  await sessions.create({ name: 'new', setup, endpoint: null, projectId: 'k2m8q4zx' });
  await mkdir(join(projectDir, 'sessions', '2026-11-03_02-14-10_cccccccccc'), { recursive: true });
  await writeFile(
    join(projectDir, 'sessions', '2026-11-03_02-14-10_cccccccccc', 'session.json'),
    '{',
  );
  await mkdir(join(projectDir, 'sessions', 'not-a-session'), { recursive: true });
  await writeFile(join(projectDir, 'sessions', 'not-a-session', 'session.json'), '{}');
  const listed = await sessions.list();
  deepEqual(
    listed.map((item) => item.id),
    ['bbbbbbbbbb', 'aaaaaaaaaa'],
  );
});

test('appendEvents and readEvents skip invalid lines', async () => {
  const projectDir = await tempDir();
  const sessions = createSessionStore({
    projectDir,
    now: () => new Date('2026-11-03T02:14:08.000Z'),
    random: queueRandom(['x7ootg10qc']),
  });
  const { record } = await sessions.create({
    name: null,
    setup,
    endpoint: null,
    projectId: 'k2m8q4zx',
  });
  await sessions.appendEvents(record.id, [event(1), event(2)]);
  const file = sessions.paths(record.id).eventsFile;
  await writeFile(file, `${await readFile(file, 'utf8')}not-json\n`);
  const { events, skipped } = await sessions.readEvents(record.id);
  equal(events.length, 2);
  equal(skipped, 1);
});

test('update, get from a fresh store, and markInterrupted', async () => {
  const projectDir = await tempDir();
  const first = createSessionStore({
    projectDir,
    now: () => new Date('2026-11-03T02:14:08.000Z'),
    random: queueRandom(['aaaaaaaaaa', 'bbbbbbbbbb']),
  });
  const a = await first.create({ name: 'a', setup, endpoint: null, projectId: 'p1p1p1p1' });
  const b = await first.create({ name: 'b', setup, endpoint: null, projectId: 'p1p1p1p1' });
  await first.update(b.record.id, {
    name: 'done',
    status: 'stopped',
    stoppedAt: '2026-11-03T03:00:00.000Z',
  });
  const second = createSessionStore({
    projectDir,
    now: () => new Date('2026-11-03T04:00:00.000Z'),
    random: queueRandom(['cccccccccc']),
  });
  equal((await second.get(a.record.id)).status, 'recording');
  deepEqual(await second.markInterrupted(), [a.record.id]);
  equal((await second.get(a.record.id)).status, 'interrupted');
  equal((await second.get(b.record.id)).status, 'stopped');
});

test('remove deletes only the session folder', async () => {
  const projectDir = await tempDir();
  const sessions = createSessionStore({
    projectDir,
    now: () => new Date('2026-11-03T02:14:08.000Z'),
    random: queueRandom(['x7ootg10qc']),
  });
  const { record } = await sessions.create({
    name: 'x',
    setup,
    endpoint: null,
    projectId: 'k2m8q4zx',
  });
  await sessions.remove(record.id);
  try {
    await sessions.get(record.id);
    throw new Error('expected NOT_FOUND');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'NOT_FOUND');
  }
  await access(join(projectDir, 'sessions'));
});
