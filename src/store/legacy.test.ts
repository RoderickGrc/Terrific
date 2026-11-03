import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { createLegacyReader } from './legacy.ts';

const START = '2026-03-01T10:00:00.000Z';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function sessionDir(root: string, folder: string): Promise<string> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('legacy reader lists stores, maps status, and reads events by authority', async () => {
  const dataRoot = await tempRoot('legacy-reader-');
  const shopTerrific = join(dataRoot, 'Work', 'Shop-Frontend', '.terrific');
  const shopSessions = join(shopTerrific, 'sessions');
  const globalSessions = join(dataRoot, 'sessions');
  await mkdir(shopSessions, { recursive: true });
  await mkdir(globalSessions, { recursive: true });

  await writeJson(join(dataRoot, 'workspaces.json'), {
    workspaces: {
      shop0001: {
        id: 'shop0001',
        path: shopTerrific,
        createdAt: START,
        lastAccessedAt: START,
      },
    },
    defaultWorkspace: 'shop0001',
  });

  const completedDir = await sessionDir(shopSessions, '2026-03-01_10-00-00_shopflow01');
  await writeJson(join(completedDir, 'metadata.json'), {
    id: 'shopflow01',
    name: 'checkout',
    status: 'completed',
    startTime: Date.parse(START),
    createdAt: START,
    config: {
      sessionType: 'browser',
      recordActions: true,
      recordNetwork: true,
      recordConsole: false,
      initialUrl: 'https://example.test/app',
    },
  });
  await writeJson(join(completedDir, 'events.json'), [
    {
      id: 'n1',
      type: 'NOTE',
      message: 'ready',
      timestamp: '2026-03-01T10:00:01.000Z',
    },
  ]);
  await writeFile(join(completedDir, '2026-03-01T10-00-01-checkout-context.txt'), 'one\n', 'utf8');
  await writeFile(join(completedDir, '2026-03-01T10-00-02-checkout-context.txt'), 'two\n', 'utf8');

  const debugDir = await sessionDir(shopSessions, '2026-03-01_09-00-00_debugnone1');
  await writeJson(join(debugDir, 'metadata.json'), {
    id: 'debugnone1',
    name: 'ingest only',
    status: 'completed',
    startTime: Date.parse('2026-03-01T09:00:00.000Z'),
    createdAt: '2026-03-01T09:00:00.000Z',
    config: {
      sessionType: 'debug_gateway',
      recordActions: false,
      recordNetwork: false,
      recordConsole: false,
      initialUrl: 'https://example.test/placeholder',
    },
  });
  await writeJson(join(debugDir, 'events.json'), []);

  const interruptedDir = await sessionDir(globalSessions, '2026-03-02_11-00-00_pausedjson');
  await writeJson(join(interruptedDir, 'metadata.json'), {
    id: 'pausedjson',
    status: 'interrupted',
    startTime: Date.parse('2026-03-02T11:00:00.000Z'),
    createdAt: '2026-03-02T11:00:00.000Z',
    config: {
      recordActions: true,
      recordNetwork: true,
      recordConsole: true,
      initialUrl: 'https://example.test/',
    },
  });
  await writeFile(
    join(interruptedDir, 'events.jsonl'),
    `${JSON.stringify({
      id: 'n2',
      type: 'NOTE',
      message: 'partial ok',
      timestamp: '2026-03-02T11:00:01.000Z',
    })}\n{"id":"n3","type":"NOTE","message":"trunca`,
    'utf8',
  );

  const recordingDir = await sessionDir(globalSessions, '2026-03-03_08-00-00_stillopen1');
  await writeJson(join(recordingDir, 'metadata.json'), {
    id: 'stillopen1',
    status: 'recording',
    startTime: Date.parse('2026-03-03T08:00:00.000Z'),
    createdAt: '2026-03-03T08:00:00.000Z',
    config: { recordActions: true, recordNetwork: false, recordConsole: false, initialUrl: '' },
  });
  await writeFile(join(recordingDir, 'events.jsonl'), '', 'utf8');

  await mkdir(join(globalSessions, 'orphan-folder'), { recursive: true });
  await writeFile(join(globalSessions, 'orphan-folder', 'events.json'), '[]\n', 'utf8');

  const reader = createLegacyReader({ dataRoot });
  const stores = await reader.listStores();
  equal(stores.length, 2);
  equal(stores[0]?.kind, 'global');
  equal(stores[0]?.projectPath, null);
  equal(stores[1]?.kind, 'workspace');
  match(stores[1]?.projectPath ?? '', /Shop-Frontend$/);

  const global = stores[0];
  const workspace = stores[1];
  ok(global);
  ok(workspace);

  const globalSessionsList = await reader.listSessions(global);
  deepEqual(
    globalSessionsList.map((item) => item.id),
    ['stillopen1', 'pausedjson'],
  );
  equal(globalSessionsList[0]?.status, 'interrupted');
  equal(globalSessionsList[1]?.status, 'interrupted');

  const workspaceSessions = await reader.listSessions(workspace);
  deepEqual(
    workspaceSessions.map((item) => item.id),
    ['shopflow01', 'debugnone1'],
  );
  equal(workspaceSessions[0]?.status, 'stopped');
  equal(workspaceSessions[0]?.hasContext, true);
  equal(workspaceSessions[1]?.status, 'stopped');

  const completed = workspaceSessions[0];
  ok(completed);
  const completedRead = await reader.readSession(completed);
  equal(completedRead.summary.legacy, true);
  equal(completedRead.summary.projectPath, workspace.projectPath);
  equal(completedRead.summary.setup.target, 'browser');
  equal(completedRead.summary.setup.url, 'https://example.test/app');
  equal(completedRead.summary.setup.profile, 'clean');
  deepEqual(completedRead.summary.setup.record, { actions: true, network: true, console: false });
  equal(completedRead.summary.setup.endpoint, null);
  equal(completedRead.events.length, 1);
  equal(completedRead.skipped, 0);
  equal(completedRead.recovered, false);
  ok(completedRead.contextFile?.endsWith('2026-03-01T10-00-02-checkout-context.txt'));

  const debug = workspaceSessions[1];
  ok(debug);
  const debugRead = await reader.readSession(debug);
  equal(debugRead.summary.setup.target, 'none');
  equal(debugRead.summary.projectPath, workspace.projectPath);

  const interrupted = globalSessionsList[1];
  ok(interrupted);
  const interruptedRead = await reader.readSession(interrupted);
  equal(interruptedRead.events.length, 1);
  equal(interruptedRead.events[0]?.kind, 'note');
  equal(interruptedRead.summary.projectPath, '');
  equal(interruptedRead.summary.stoppedAt, null);

  const byProject = await reader.forProject(join(dataRoot, 'Work', 'shop-frontend'));
  deepEqual(
    byProject.map((item) => item.id),
    ['shopflow01', 'debugnone1'],
  );
  const none = await reader.forProject(join(dataRoot, 'Work', 'other-app'));
  equal(none.length, 0);
});

test('readSession recovers a truncated events.json and counts an unreadable file', async () => {
  const dataRoot = await tempRoot('legacy-recover-');
  const sessionsDir = join(dataRoot, 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  const recoveredDir = await sessionDir(sessionsDir, '2026-03-01_10-00-00_truncok01');
  await writeJson(join(recoveredDir, 'metadata.json'), {
    id: 'truncok01',
    status: 'completed',
    startTime: Date.parse(START),
    createdAt: START,
    config: { recordActions: true, recordNetwork: false, recordConsole: false, initialUrl: '' },
  });
  const kept = {
    id: 'n1',
    type: 'NOTE',
    message: 'kept',
    timestamp: '2026-03-01T10:00:01.000Z',
  };
  const body = JSON.stringify([kept]);
  await writeFile(join(recoveredDir, 'events.json'), `${body}${body.slice(0, 24)}`, 'utf8');

  const badDir = await sessionDir(sessionsDir, '2026-03-01_11-00-00_badjson01');
  await writeJson(join(badDir, 'metadata.json'), {
    id: 'badjson01',
    status: 'completed',
    startTime: Date.parse('2026-03-01T11:00:00.000Z'),
    createdAt: '2026-03-01T11:00:00.000Z',
    config: { recordActions: true, recordNetwork: false, recordConsole: false, initialUrl: '' },
  });
  await writeFile(join(badDir, 'events.json'), 'not-json leftover', 'utf8');

  const reader = createLegacyReader({ dataRoot });
  const stores = await reader.listStores();
  const global = stores[0];
  ok(global);
  const listed = await reader.listSessions(global);
  const recoveredInfo = listed.find((item) => item.id === 'truncok01');
  const badInfo = listed.find((item) => item.id === 'badjson01');
  ok(recoveredInfo);
  ok(badInfo);

  const recoveredRead = await reader.readSession(recoveredInfo);
  equal(recoveredRead.recovered, true);
  equal(recoveredRead.skipped, 0);
  equal(recoveredRead.events.length, 1);
  equal(recoveredRead.events[0]?.kind, 'note');

  const badRead = await reader.readSession(badInfo);
  equal(badRead.recovered, false);
  equal(badRead.events.length, 0);
  equal(badRead.skipped, 1);
});

test('malformed workspaces.json yields no workspace stores', async () => {
  const dataRoot = await tempRoot('legacy-badws-');
  await mkdir(join(dataRoot, 'sessions'), { recursive: true });
  await writeFile(join(dataRoot, 'workspaces.json'), '{ not json', 'utf8');
  const reader = createLegacyReader({ dataRoot });
  const stores = await reader.listStores();
  equal(stores.length, 1);
  equal(stores[0]?.kind, 'global');
});
