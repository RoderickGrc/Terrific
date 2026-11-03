import { deepEqual, equal, rejects } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createProfileStore } from './profiles.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-profiles-'));
  dirs.push(dir);
  return createProfileStore({
    dir: join(dir, 'profiles'),
    now: () => new Date('2026-11-03T14:00:00Z'),
  });
}

test('a new store lists nothing, then lists created profiles by name', async () => {
  const profiles = await store();
  deepEqual(await profiles.list(), []);
  await profiles.create({ name: 'qa-admin', mode: 'snapshot', browser: 'edge', url: '' });
  await profiles.create({
    name: 'daily',
    mode: 'persistent',
    browser: 'chrome',
    url: 'https://a.test',
  });
  deepEqual(
    (await profiles.list()).map((record) => [
      record.name,
      record.mode,
      record.browser,
      record.savedAt,
    ]),
    [
      ['daily', 'persistent', 'chrome', null],
      ['qa-admin', 'snapshot', 'edge', null],
    ],
  );
});

test('names are checked and must be unique', async () => {
  const profiles = await store();
  await rejects(
    profiles.create({ name: 'Bad Name', mode: 'persistent', browser: 'edge', url: '' }),
    /lowercase letters/,
  );
  await rejects(
    profiles.create({ name: 'clean', mode: 'persistent', browser: 'edge', url: '' }),
    /cannot be "clean"/,
  );
  await profiles.create({ name: 'qa', mode: 'persistent', browser: 'edge', url: '' });
  await rejects(
    profiles.create({ name: 'qa', mode: 'snapshot', browser: 'edge', url: '' }),
    /already exists/,
  );
});

test('writeState saves the state privately and stamps savedAt', async () => {
  const profiles = await store();
  await profiles.create({ name: 'qa', mode: 'snapshot', browser: 'edge', url: '' });
  const record = await profiles.writeState('qa', '{"cookies":[],"origins":[]}');
  equal(record.savedAt, '2026-11-03T14:00:00.000Z');
  equal(await readFile(profiles.paths('qa').stateFile, 'utf8'), '{"cookies":[],"origins":[]}');
});

test('rename moves the folder with its data; remove deletes it', async () => {
  const profiles = await store();
  await profiles.create({ name: 'qa', mode: 'snapshot', browser: 'edge', url: '' });
  await profiles.writeState('qa', '{}');
  await profiles.create({ name: 'other', mode: 'persistent', browser: 'edge', url: '' });
  await rejects(profiles.rename('qa', 'other'), /already exists/);
  const renamed = await profiles.rename('qa', 'admin');
  equal(renamed.name, 'admin');
  equal(existsSync(profiles.paths('qa').folder), false);
  equal(await readFile(profiles.paths('admin').stateFile, 'utf8'), '{}');
  equal((await profiles.get('admin'))?.name, 'admin');
  await profiles.remove('admin');
  equal(existsSync(profiles.paths('admin').folder), false);
  await rejects(profiles.remove('admin'), /No profile called "admin"/);
});
