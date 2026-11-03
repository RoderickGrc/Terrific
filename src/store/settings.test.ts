import { deepEqual, equal } from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createSettingsStore, defaultProjectSettings } from './settings.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-'));
  dirs.push(dir);
  return dir;
}

test('read returns defaults when settings.json is missing', async () => {
  const projectDir = await tempDir();
  const settings = createSettingsStore({ projectDir });
  deepEqual(await settings.read(), defaultProjectSettings());
});

test('write merges a patch and read returns the saved settings', async () => {
  const projectDir = await tempDir();
  const settings = createSettingsStore({ projectDir });
  const saved = await settings.write({
    lastSetup: { url: 'http://app.test', record: { console: false } },
    visibility: { ingest: false },
    pinned: ['x7ootg10qc'],
  });
  equal(saved.lastSetup.target, 'browser');
  equal(saved.lastSetup.url, 'http://app.test');
  equal(saved.lastSetup.record.console, false);
  equal(saved.lastSetup.record.actions, true);
  equal(saved.visibility.action, true);
  equal(saved.visibility.ingest, false);
  deepEqual(saved.pinned, ['x7ootg10qc']);
  deepEqual(await settings.read(), saved);
});

test('unknown or invalid fields fall back field by field', async () => {
  const projectDir = await tempDir();
  await writeFile(
    join(projectDir, 'settings.json'),
    JSON.stringify({
      version: 9,
      lastSetup: { target: 'mobile', url: 1, record: { actions: 'yes' }, extra: true },
      visibility: { action: false, network: 'no' },
      pinned: ['ok', 3, null],
    }),
  );
  const settings = createSettingsStore({ projectDir });
  const read = await settings.read();
  equal(read.lastSetup.target, 'browser');
  equal(read.lastSetup.url, '');
  equal(read.lastSetup.record.actions, true);
  equal(read.visibility.action, false);
  equal(read.visibility.network, true);
  deepEqual(read.pinned, ['ok']);
});

test('invalid JSON falls back to defaults without throwing', async () => {
  const projectDir = await tempDir();
  await writeFile(join(projectDir, 'settings.json'), '{');
  const settings = createSettingsStore({ projectDir });
  deepEqual(await settings.read(), defaultProjectSettings());
});
