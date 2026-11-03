import { deepEqual, equal } from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { test } from 'node:test';
import { findInstalledBrowsers } from './browsers.ts';

test('findInstalledBrowsers is empty when nothing exists', () => {
  deepEqual(
    findInstalledBrowsers({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
        PROGRAMFILES: 'C:\\Program Files',
        'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      },
      exists: () => false,
    }),
    [],
  );
});

test('findInstalledBrowsers on Windows reports Chrome, Edge and Comet paths', () => {
  const local = 'C:\\Users\\x\\AppData\\Local';
  const chrome = win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe');
  const edge = win32.join('C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const comet = win32.join(local, 'Perplexity', 'Comet', 'Application', 'comet.exe');
  const present = new Set([chrome, edge, comet]);

  const found = findInstalledBrowsers({
    platform: 'win32',
    env: {
      LOCALAPPDATA: local,
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    },
    exists: (path) => present.has(path),
  });

  equal(found.length, 3);
  deepEqual(found[0], {
    id: 'chrome',
    name: 'Google Chrome',
    executablePath: chrome,
    userDataRoot: win32.join(local, 'Google', 'Chrome', 'User Data'),
  });
  deepEqual(found[1], {
    id: 'edge',
    name: 'Microsoft Edge',
    executablePath: edge,
    userDataRoot: win32.join(local, 'Microsoft', 'Edge', 'User Data'),
  });
  deepEqual(found[2], {
    id: 'comet',
    name: 'Comet',
    executablePath: comet,
    userDataRoot: win32.join(local, 'Perplexity', 'Comet', 'User Data'),
  });
});

test('findInstalledBrowsers prefers Program Files Chrome over LocalAppData', () => {
  const program = win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const local = win32.join(
    'C:\\Users\\x\\AppData\\Local',
    'Google',
    'Chrome',
    'Application',
    'chrome.exe',
  );
  const found = findInstalledBrowsers({
    platform: 'win32',
    env: {
      LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
      PROGRAMFILES: 'C:\\Program Files',
    },
    exists: (path) => path === program || path === local,
  });
  equal(found[0]?.executablePath, program);
});

test('findInstalledBrowsers on macOS reports Chrome and leaves Comet user data null', () => {
  const chrome = posix.join(
    '/Applications',
    'Google Chrome.app',
    'Contents',
    'MacOS',
    'Google Chrome',
  );
  const comet = posix.join('/Applications', 'Comet.app', 'Contents', 'MacOS', 'Comet');
  const found = findInstalledBrowsers({
    platform: 'darwin',
    env: { HOME: '/Users/x' },
    exists: (path) => path === chrome || path === comet,
  });
  deepEqual(found, [
    {
      id: 'chrome',
      name: 'Google Chrome',
      executablePath: chrome,
      userDataRoot: posix.join('/Users/x', 'Library', 'Application Support', 'Google', 'Chrome'),
    },
    { id: 'comet', name: 'Comet', executablePath: comet, userDataRoot: null },
  ]);
});

test('findInstalledBrowsers on Linux searches usr and snap bins', () => {
  const chrome = posix.join('/snap/bin', 'google-chrome-stable');
  const chromium = posix.join('/usr/bin', 'chromium');
  const found = findInstalledBrowsers({
    platform: 'linux',
    env: { HOME: '/home/x' },
    exists: (path) => path === chrome || path === chromium,
  });
  deepEqual(found, [
    {
      id: 'chrome',
      name: 'Google Chrome',
      executablePath: chrome,
      userDataRoot: posix.join('/home/x', '.config', 'google-chrome'),
    },
    {
      id: 'chromium',
      name: 'Chromium',
      executablePath: chromium,
      userDataRoot: posix.join('/home/x', '.config', 'chromium'),
    },
  ]);
});
