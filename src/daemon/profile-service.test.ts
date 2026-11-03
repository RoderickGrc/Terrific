import { deepEqual, equal, match, rejects } from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { BrowserContext, Page } from 'playwright-core';
import type { InstalledBrowser } from '../recorder/browsers.ts';
import type { LaunchedBrowser, LaunchOptions } from '../recorder/launch.ts';
import { createProfileStore } from '../store/profiles.ts';
import { createProfileService } from './profile-service.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const BROWSERS: InstalledBrowser[] = [
  { id: 'edge', name: 'Microsoft Edge', executablePath: '/edge', userDataRoot: '/edge-data' },
  { id: 'comet', name: 'Comet', executablePath: '/comet', userDataRoot: '/comet-data' },
];

/** A window with one tab whose storage state the test sets. */
class FakeWindow {
  state = { cookies: [] as unknown[], origins: [] as unknown[] };
  readonly context = new EventEmitter();
  readonly page = new EventEmitter();
  pageOpen = true;
  closed = false;
  visited: string[] = [];
  /** How many times the service read the state. */
  reads = 0;

  launched(): LaunchedBrowser {
    const context = Object.assign(this.context, {
      pages: () => (this.pageOpen ? [this.page] : []),
      storageState: async () => {
        if (this.closed) throw new Error('closed');
        this.reads += 1;
        return this.state;
      },
    });
    const page = Object.assign(this.page, {
      goto: async (url: string) => {
        this.visited.push(url);
        return null;
      },
    });
    return {
      context: context as unknown as BrowserContext,
      page: page as unknown as Page,
      close: async () => {
        this.closed = true;
      },
    };
  }

  /** The tester closes the window. */
  closeWindow(): void {
    this.pageOpen = false;
    this.closed = true;
    this.page.emit('close');
  }
}

async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-profile-service-'));
  dirs.push(dir);
  const store = createProfileStore({ dir, now: () => new Date('2026-11-03T14:00:00Z') });
  const launches: LaunchOptions[] = [];
  const windows: FakeWindow[] = [];
  const profiles = createProfileService({
    store,
    headless: true,
    installedBrowsers: () => BROWSERS,
    launch: async (options) => {
      launches.push(options);
      const window = new FakeWindow();
      windows.push(window);
      return window.launched();
    },
    captureEveryMs: 10,
  });
  return { profiles, store, launches, windows };
}

/** Polls until `done` holds, so timing under a loaded machine does not fail the test. */
async function until(done: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('condition not reached in 2 s');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('list shows clean on the first installed browser, then the profiles terrific keeps', async () => {
  const { profiles } = await service();
  await profiles.create({ name: 'testing', mode: 'persistent', browser: 'comet' });
  await profiles.create({ name: 'qa', mode: 'snapshot' });
  deepEqual(
    (await profiles.list()).map((view) => [view.slug, view.kind, view.detail]),
    [
      ['clean', 'clean', 'fresh storage, nothing saved'],
      ['qa', 'snapshot', 'Microsoft Edge · nothing saved yet'],
      ['testing', 'persistent', 'Comet · keeps logins and data'],
    ],
  );
  deepEqual(profiles.browsers(), [
    { id: 'edge', name: 'Microsoft Edge' },
    { id: 'comet', name: 'Comet' },
  ]);
});

test('resolve gives persistent profiles their folder and snapshot profiles their state file', async () => {
  const { profiles, store } = await service();
  await profiles.create({ name: 'daily', mode: 'persistent', browser: 'comet' });
  await profiles.create({ name: 'qa', mode: 'snapshot', browser: 'edge' });
  const daily = await profiles.resolve('daily');
  equal(daily.executablePath, '/comet');
  equal(daily.userDataDir, store.paths('daily').browserDir);
  equal(daily.storageState, undefined);
  const qa = await profiles.resolve('qa');
  equal(qa.userDataDir, null);
  equal(qa.storageState, store.paths('qa').stateFile);
  await rejects(
    profiles.resolve('nope'),
    /No profile called "nope"\. Create it with: terrific profiles add nope/,
  );
  const clean = await profiles.resolve('clean');
  equal(clean.executablePath, '/edge');
  equal(clean.userDataDir, null);
  equal(clean.storageState, undefined);
  await rejects(
    profiles.create({ name: 'x', mode: 'persistent', browser: 'chrome' }),
    /Google Chrome is not installed/,
  );
});

test('a snapshot profile saves its state when closed from the CLI', async () => {
  const { profiles, store, windows } = await service();
  await profiles.create({ name: 'qa', mode: 'snapshot', url: 'app.test/login' });
  const opened = await profiles.open('qa');
  equal(opened.open, true);
  const window = windows[0];
  if (window === undefined) throw new Error('no window');
  deepEqual(window.visited, ['https://app.test/login']);
  await rejects(profiles.open('qa'), /already open/);
  await rejects(profiles.rename('qa', 'other'), /Close the profile "qa" before you rename it/);
  window.state = { cookies: [{ name: 'sid' }], origins: [] };
  const closed = await profiles.close('qa');
  equal(closed.open, false);
  match(closed.detail, /Microsoft Edge · saved 2026-11-03/);
  equal(await readFile(store.paths('qa').stateFile, 'utf8'), JSON.stringify(window.state));
  equal(window.closed, true);
});

test('closing the window keeps the last state read while it was open', async () => {
  const { profiles, store, windows } = await service();
  await profiles.create({ name: 'qa', mode: 'snapshot' });
  await profiles.open('qa');
  const window = windows[0];
  if (window === undefined) throw new Error('no window');
  window.state = { cookies: [], origins: [{ origin: 'https://app.test', localStorage: [] }] };
  const before = window.reads;
  await until(() => window.reads > before);
  window.closeWindow();
  await until(
    async () => (await profiles.list()).find((view) => view.slug === 'qa')?.open === false,
  );
  equal(await readFile(store.paths('qa').stateFile, 'utf8'), JSON.stringify(window.state));
});

test('an empty capture never replaces a saved state', async () => {
  const { profiles, store, windows } = await service();
  await profiles.create({ name: 'qa', mode: 'snapshot' });
  await store.writeState('qa', '{"cookies":[{"name":"old"}],"origins":[]}');
  await profiles.open('qa');
  await profiles.close('qa');
  equal(windows.length, 1);
  equal(
    await readFile(store.paths('qa').stateFile, 'utf8'),
    '{"cookies":[{"name":"old"}],"origins":[]}',
  );
});

test('a persistent profile open for setup cannot record until it is closed', async () => {
  const { profiles } = await service();
  await profiles.create({ name: 'daily', mode: 'persistent' });
  await profiles.open('daily');
  await rejects(profiles.resolve('daily'), /open for setup\. Close it first/);
  await profiles.close('daily');
  equal((await profiles.resolve('daily')).profileLabel, 'daily');
  await rejects(profiles.close('daily'), /is not open/);
});
