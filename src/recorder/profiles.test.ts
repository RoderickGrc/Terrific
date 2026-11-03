import { deepEqual, equal } from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { InstalledBrowser } from './browsers.ts';
import {
  CHROME_PROFILE_BLOCKED,
  discoverProfiles,
  profileAutomationFailed,
  toLaunchOptions,
} from './profiles.ts';

function chrome(root: string): InstalledBrowser {
  return {
    id: 'chrome',
    name: 'Google Chrome',
    executablePath: '/chrome',
    userDataRoot: root,
  };
}

function edge(root: string): InstalledBrowser {
  return {
    id: 'edge',
    name: 'Microsoft Edge',
    executablePath: '/edge',
    userDataRoot: root,
  };
}

function localState(entries: Record<string, unknown>): string {
  return JSON.stringify({ profile: { info_cache: entries } });
}

test('discoverProfiles puts clean first and sorts Default before Profile N', () => {
  const chromeRoot = join('chrome-root');
  const files = new Map<string, string>([
    [
      join(chromeRoot, 'Local State'),
      localState({
        'Profile 4': { name: 'Work' },
        Default: { name: 'Person 1' },
        'Profile 1': { name: 'Testing' },
      }),
    ],
  ]);
  const found = discoverProfiles({
    browsers: [chrome(chromeRoot)],
    readFile: (path) => files.get(path) ?? null,
  });
  deepEqual(
    found.map((profile) => profile.id),
    ['clean', 'chrome:Default', 'chrome:Profile 1', 'chrome:Profile 4'],
  );
  equal(found[0]?.slug, 'clean');
  equal(found[0]?.label, 'Clean browser');
  equal(found[0]?.detail, 'fresh storage, nothing saved');
  equal(found[0]?.userDataDir, null);
  equal(found[1]?.label, 'Person 1');
  equal(found[1]?.detail, 'Google Chrome · Default');
  equal(found[1]?.blockedReason, CHROME_PROFILE_BLOCKED);
  equal(found[2]?.slug, 'testing');
});

test('discoverProfiles deduplicates the same label across browsers', () => {
  const chromeRoot = join('chrome-root');
  const edgeRoot = join('edge-root');
  const files = new Map<string, string>([
    [join(chromeRoot, 'Local State'), localState({ Default: { name: 'Testing' } })],
    [join(edgeRoot, 'Local State'), localState({ Default: { name: 'Testing' } })],
  ]);
  const found = discoverProfiles({
    browsers: [chrome(chromeRoot), edge(edgeRoot)],
    readFile: (path) => files.get(path) ?? null,
  });
  deepEqual(
    found.map((profile) => [profile.slug, profile.id, profile.blockedReason]),
    [
      ['clean', 'clean', null],
      ['testing', 'chrome:Default', CHROME_PROFILE_BLOCKED],
      ['testing-edge', 'edge:Default', null],
    ],
  );
  equal(found[2]?.detail, 'Microsoft Edge · Default');
});

test('discoverProfiles skips a missing Local State and invalid JSON without throwing', () => {
  const chromeRoot = join('chrome-root');
  const edgeRoot = join('edge-root');
  const comet: InstalledBrowser = {
    id: 'comet',
    name: 'Comet',
    executablePath: '/comet',
    userDataRoot: join('comet-root'),
  };
  const files = new Map<string, string>([
    [join(chromeRoot, 'Local State'), '{not-json'],
    [join(edgeRoot, 'Local State'), JSON.stringify({ profile: { info_cache: 'nope' } })],
  ]);
  const found = discoverProfiles({
    browsers: [chrome(chromeRoot), edge(edgeRoot), comet],
    readFile: (path) => files.get(path) ?? null,
  });
  deepEqual(
    found.map((profile) => profile.id),
    ['clean'],
  );
});

test('discoverProfiles is empty when no browser is installed', () => {
  deepEqual(
    discoverProfiles({
      browsers: [],
      readFile: () => {
        throw new Error('readFile should not run');
      },
    }),
    [],
  );
});

test('toLaunchOptions maps clean and persistent profiles', () => {
  const chromeRoot = join('chrome-root');
  const found = discoverProfiles({
    browsers: [edge(join('edge-root')), chrome(chromeRoot)],
    readFile: (path) =>
      path === join(chromeRoot, 'Local State')
        ? localState({ Default: { name: 'Person 1' } })
        : null,
  });
  const clean = found[0];
  const person = found.find((profile) => profile.id === 'chrome:Default');
  if (clean === undefined || person === undefined) throw new Error('expected clean and chrome');
  // Clean follows chrome, edge, chromium, comet, not the installed-array order.
  deepEqual(toLaunchOptions(clean, true), {
    executablePath: '/chrome',
    userDataDir: null,
    headless: true,
    browserName: 'Google Chrome',
    profileLabel: 'Clean browser',
  });
  equal(toLaunchOptions(person, false).profileDirectory, 'Default');
  equal(toLaunchOptions(person, false).userDataDir, chromeRoot);
});

test('profileAutomationFailed names the browser and the @clean fallback', () => {
  equal(
    profileAutomationFailed('Microsoft Edge', 'Work'),
    'Microsoft Edge did not accept automation for profile "Work". Close Microsoft Edge if it is open, or use @clean.',
  );
});
