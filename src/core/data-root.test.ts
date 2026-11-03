import { deepEqual, equal } from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { dataPaths, resolveDataRoot } from './data-root.ts';

test('resolveDataRoot uses TERRIFIC_HOME when set and non-empty', () => {
  equal(
    resolveDataRoot({
      env: { TERRIFIC_HOME: 'D:\\data\\terrific' },
      platform: 'win32',
      homedir: 'C:\\Users\\x',
    }),
    'D:\\data\\terrific',
  );
});

test('resolveDataRoot ignores an empty TERRIFIC_HOME', () => {
  equal(
    resolveDataRoot({ env: { TERRIFIC_HOME: '' }, platform: 'win32', homedir: 'C:\\Users\\x' }),
    join('C:\\Users\\x', 'Documents', '.terrific'),
  );
});

test('resolveDataRoot uses Documents/.terrific on win32', () => {
  equal(
    resolveDataRoot({ env: {}, platform: 'win32', homedir: 'C:\\Users\\x' }),
    join('C:\\Users\\x', 'Documents', '.terrific'),
  );
});

test('resolveDataRoot uses ~/.terrific on other platforms', () => {
  equal(
    resolveDataRoot({ env: {}, platform: 'darwin', homedir: '/Users/x' }),
    join('/Users/x', '.terrific'),
  );
  equal(
    resolveDataRoot({ env: {}, platform: 'linux', homedir: '/home/x' }),
    join('/home/x', '.terrific'),
  );
});

test('dataPaths lists every fixed file under the root', () => {
  const root = join('D:', 'data', '.terrific');
  deepEqual(dataPaths(root), {
    daemonFile: join(root, 'daemon.json'),
    daemonLog: join(root, 'daemon.log'),
    tokenFile: join(root, 'token'),
    configFile: join(root, 'config.json'),
    projectsIndex: join(root, 'projects.json'),
    projectsDir: join(root, 'projects'),
    profilesDir: join(root, 'profiles'),
    legacySessionsDir: join(root, 'sessions'),
    legacyWorkspacesFile: join(root, 'workspaces.json'),
  });
});
