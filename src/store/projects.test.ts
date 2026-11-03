import { equal, match } from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { isTerrificError } from '../core/errors.ts';
import type { RandomSource } from '../core/ids.ts';
import { createProjectStore } from './projects.ts';

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

function store(
  root: string,
  now: string,
  ids: string[] = ['aaaaaaaa'],
): ReturnType<typeof createProjectStore> {
  return createProjectStore({ root, now: () => new Date(now), random: queueRandom(ids) });
}

test('resolve creates a new project when nothing matches', async () => {
  const root = await tempDir();
  const projects = store(root, '2026-01-01T00:00:00.000Z');
  const info = await projects.resolve('D:\\work\\shop');
  equal(info.id, 'aaaaaaaa');
  equal(info.cwd, 'D:\\work\\shop');
  match(info.dir, /aaaaaaaa$/);
  equal(info.createdAt, '2026-01-01T00:00:00.000Z');
  const listed = await projects.list();
  equal(listed.length, 1);
  equal(listed[0]?.id, 'aaaaaaaa');
});

test('resolve reuses a workspace id across case and a trailing .terrific', async () => {
  const root = await tempDir();
  await writeFile(
    join(root, 'workspaces.json'),
    JSON.stringify({
      workspaces: {
        one: {
          id: 'k2m8q4zx',
          path: 'D:\\work\\shop-frontend\\.terrific',
          lastAccessedAt: '2026-02-01T00:00:00.000Z',
        },
      },
    }),
  );
  const info = await store(root, '2026-03-01T00:00:00.000Z').resolve('d:/work/shop-frontend');
  equal(info.id, 'k2m8q4zx');
});

test('resolve picks the most recently accessed matching workspace', async () => {
  const root = await tempDir();
  await writeFile(
    join(root, 'workspaces.json'),
    JSON.stringify({
      workspaces: {
        old: {
          id: 'oldid001',
          path: 'D:\\work\\shop',
          lastAccessedAt: '2026-01-01T00:00:00.000Z',
        },
        fresh: {
          id: 'newid002',
          path: 'd:\\work\\shop\\.terrific',
          lastAccessedAt: '2026-06-01T00:00:00.000Z',
        },
      },
    }),
  );
  const info = await store(root, '2026-07-01T00:00:00.000Z').resolve('D:\\work\\shop');
  equal(info.id, 'newid002');
});

test('resolve allocates a new id when the reused workspace id is taken', async () => {
  const root = await tempDir();
  await writeFile(
    join(root, 'workspaces.json'),
    JSON.stringify({
      workspaces: {
        clash: {
          id: 'taken001',
          path: 'D:\\work\\shop',
          lastAccessedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
  );
  const first = store(root, '2026-01-01T00:00:00.000Z', ['taken001']);
  await first.resolve('D:\\other\\app');
  const second = store(root, '2026-01-02T00:00:00.000Z', ['taken001', 'fresh002']);
  const info = await second.resolve('D:\\work\\shop');
  equal(info.id, 'fresh002');
});

test('resolve is idempotent and only refreshes lastOpenedAt', async () => {
  const root = await tempDir();
  const first = await store(root, '2026-01-01T00:00:00.000Z').resolve('D:\\work\\shop');
  const later = store(root, '2026-01-02T00:00:00.000Z');
  const again = await later.resolve('D:\\work\\shop\\.terrific');
  equal(again.id, first.id);
  equal(again.createdAt, first.createdAt);
  equal(again.lastOpenedAt, '2026-01-02T00:00:00.000Z');
});

test('list sorts by lastOpenedAt descending and get looks up by id', async () => {
  const root = await tempDir();
  await store(root, '2026-01-01T00:00:00.000Z', ['older001']).resolve('D:\\a');
  await store(root, '2026-02-01T00:00:00.000Z', ['newer002']).resolve('D:\\b');
  const listed = await store(root, '2026-03-01T00:00:00.000Z').list();
  equal(listed.map((item) => item.id).join(','), 'newer002,older001');
  const got = await store(root, '2026-03-01T00:00:00.000Z').get('older001');
  equal(got.cwd, 'D:\\a');
});

test('get throws NOT_FOUND for an unknown project', async () => {
  const root = await tempDir();
  try {
    await store(root, '2026-01-01T00:00:00.000Z').get('missing1');
    throw new Error('expected NOT_FOUND');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'NOT_FOUND');
  }
});

test('a missing or malformed workspaces.json is treated as empty', async () => {
  const root = await tempDir();
  await writeFile(join(root, 'workspaces.json'), '{');
  const info = await store(root, '2026-01-01T00:00:00.000Z').resolve('D:\\work\\shop');
  equal(info.id, 'aaaaaaaa');
});
