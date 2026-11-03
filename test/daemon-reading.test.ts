import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { getRandomValues } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import {
  type ContextResponse,
  legacySessionsPath,
  type ProjectSettingsView,
  type ProjectView,
  type PromptResponse,
  projectSettingsPath,
  resolveProjectPath,
  type SessionDetail,
  type SessionListItem,
  type SessionView,
  sessionContextPath,
  sessionEventsPath,
  sessionMarksPath,
  sessionPath,
  sessionPromptPath,
  sessionStopPath,
  sessionsPath,
} from '../src/core/api.ts';
import type { TerrificEvent } from '../src/core/events.ts';
import type { RandomSource } from '../src/core/ids.ts';
import type { SessionSetup } from '../src/core/setup.ts';
import { type DaemonHandle, startDaemon } from '../src/daemon/daemon.ts';

const dirs: string[] = [];
const handles: DaemonHandle[] = [];

after(async () => {
  for (const handle of handles.splice(0)) {
    try {
      await handle.close();
    } catch {
      // Already closed in the test body.
    }
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-reading-'));
  dirs.push(dir);
  return dir;
}

function random(): RandomSource {
  return (n) => getRandomValues(new Uint8Array(n));
}

function noneSetup(endpoint: string): SessionSetup {
  return {
    target: 'none',
    url: '',
    profile: 'clean',
    record: { actions: false, network: false, console: false },
    endpoint,
  };
}

function offset(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function call(
  handle: DaemonHandle,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; value: unknown }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${handle.token}` };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${handle.url}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let value: unknown = text;
  if (text !== '') {
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      value = text;
    }
  }
  return { status: res.status, value };
}

function errorMessage(value: unknown): string {
  const record = value as { error?: { message?: string } };
  return record.error?.message ?? '';
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function seedLegacy(
  dataRoot: string,
  projectCwd: string,
): Promise<{
  workspaceId: string;
  globalId: string;
  workspaceFolder: string;
}> {
  const terrificDir = join(projectCwd, '.terrific');
  const workspaceId = 'legwork01';
  const globalId = 'legglob01';
  const workspaceFolder = join(terrificDir, 'sessions', '2026-06-01_10-00-00_legwork01');
  const globalFolder = join(dataRoot, 'sessions', '2026-06-02_11-00-00_legglob01');
  await writeJson(join(dataRoot, 'workspaces.json'), {
    workspaces: {
      shop0001: {
        id: 'shop0001',
        path: terrificDir,
        createdAt: '2026-06-01T10:00:00.000Z',
        lastAccessedAt: '2026-06-01T10:00:00.000Z',
      },
    },
    defaultWorkspace: 'shop0001',
  });
  await writeJson(join(workspaceFolder, 'metadata.json'), {
    id: workspaceId,
    name: 'legacy workspace',
    status: 'completed',
    startTime: Date.parse('2026-06-01T10:00:00.000Z'),
    createdAt: '2026-06-01T10:00:00.000Z',
    config: {
      sessionType: 'browser',
      recordActions: true,
      recordNetwork: true,
      recordConsole: true,
      initialUrl: 'https://example.test/app',
    },
  });
  await writeJson(join(workspaceFolder, 'events.json'), [
    {
      id: 'n1',
      type: 'NOTE',
      message: 'legacy note',
      timestamp: '2026-06-01T10:00:01.000Z',
    },
  ]);
  await writeFile(join(workspaceFolder, 'keep-me.txt'), 'untouched\n', 'utf8');
  await writeJson(join(globalFolder, 'metadata.json'), {
    id: globalId,
    name: 'legacy global',
    status: 'completed',
    startTime: Date.parse('2026-06-02T11:00:00.000Z'),
    createdAt: '2026-06-02T11:00:00.000Z',
    config: {
      sessionType: 'browser',
      recordActions: true,
      recordNetwork: false,
      recordConsole: false,
      initialUrl: 'https://example.test/',
    },
  });
  await writeJson(join(globalFolder, 'events.json'), [
    {
      id: 'n2',
      type: 'NOTE',
      message: 'global note',
      timestamp: '2026-06-02T11:00:01.000Z',
    },
  ]);
  return { workspaceId, globalId, workspaceFolder };
}

test('reading routes: list, detail, events, context, prompt, rename, delete, settings, legacy', async () => {
  let nowMs = Date.parse('2026-06-01T12:00:00.000Z');
  const dataRoot = await tempRoot();
  const handle = await startDaemon({
    dataRoot,
    port: 0,
    appVersion: '0.0.0-test',
    now: () => new Date(nowMs),
    random: random(),
    maintenanceIntervalMs: 60_000,
  });
  handles.push(handle);

  const cwd = await tempRoot();
  const project = (await call(handle, 'POST', resolveProjectPath(), { cwd })).value as ProjectView;

  async function startNamed(name: string): Promise<SessionView> {
    nowMs += 1_000;
    const started = await call(handle, 'POST', sessionsPath(project.id), {
      name,
      setup: noneSetup('app'),
    });
    equal(started.status, 201);
    return started.value as SessionView;
  }

  async function markSession(
    session: SessionView,
    kind: 'note' | 'bug' | 'flag',
    text: string | null,
  ): Promise<void> {
    nowMs += 2_000;
    const result = await call(handle, 'POST', sessionMarksPath(session.id), { kind, text });
    equal(result.status, 200);
  }

  const first = await startNamed('first');
  await markSession(first, 'note', 'check pooling');
  await markSession(first, 'bug', null);
  await markSession(first, 'flag', 'here');

  const second = await startNamed('second');
  await markSession(second, 'note', 'again');
  await markSession(second, 'bug', null);
  await markSession(second, 'flag', 'there');

  if (first.endpoint === null) throw new Error('expected an endpoint');
  nowMs += 2_000;
  const posted = await fetch(first.endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'ingest failed', level: 'error' }),
  });
  equal(posted.status, 202);

  equal((await call(handle, 'POST', sessionStopPath(second.id))).status, 200);
  equal((await call(handle, 'POST', sessionStopPath(first.id))).status, 200);

  const listed = await call(handle, 'GET', sessionsPath(project.id));
  equal(listed.status, 200);
  const items = listed.value as SessionListItem[];
  equal(items.length, 2);
  equal(items[0]?.id, second.id);
  equal(items[1]?.id, first.id);
  for (const item of items) {
    equal(item.bugs, 1);
    equal(item.flags, 1);
    equal(item.errors, 1);
    equal(item.legacy, false);
    equal(item.pinned, false);
    equal(item.marks.length, 2);
    equal(item.marks[0]?.kind, 'bug');
    equal(item.marks[1]?.kind, 'flag');
  }

  const detail = await call(handle, 'GET', sessionPath(first.id));
  equal(detail.status, 200);
  const shown = detail.value as SessionDetail;
  equal(shown.id, first.id);
  equal(shown.stats.counts.bug, 1);
  equal(shown.stats.counts.flag, 1);
  equal(shown.verdict, '1 bug to review · 1 error · 1 flagged');

  const marks = await call(handle, 'GET', `${sessionEventsPath(first.id)}?type=bug,flag`);
  equal(marks.status, 200);
  const markEvents = marks.value as TerrificEvent[];
  equal(markEvents.length, 2);
  equal(markEvents[0]?.kind, 'bug');
  equal(markEvents[1]?.kind, 'flag');

  const bug = markEvents[0];
  if (bug === undefined) throw new Error('expected a bug event');
  const around = await call(
    handle,
    'GET',
    `${sessionEventsPath(first.id)}?around=${offset(bug.t)}&window=1s`,
  );
  equal(around.status, 200);
  const aroundEvents = around.value as TerrificEvent[];
  ok(aroundEvents.some((event) => event.id === bug.id));
  ok(aroundEvents.every((event) => Math.abs(event.t - bug.t) <= 1_000));

  const errors = await call(handle, 'GET', `${sessionEventsPath(first.id)}?type=errors`);
  equal(errors.status, 200);
  const errorEvents = errors.value as TerrificEvent[];
  equal(errorEvents.length, 1);
  equal(errorEvents[0]?.kind, 'ingest');

  const bad = await call(handle, 'GET', `${sessionEventsPath(first.id)}?window=abc`);
  equal(bad.status, 400);
  match(errorMessage(bad.value), /window/);

  const context = await call(handle, 'POST', sessionContextPath(first.id));
  equal(context.status, 200);
  const written = context.value as ContextResponse;
  ok(written.bytes > 0);
  const text = await readFile(written.path, 'utf8');
  ok(text.length > 0);

  const agent = await call(handle, 'GET', `${sessionPromptPath(first.id)}?kind=agent`);
  equal(agent.status, 200);
  const prompt = (agent.value as PromptResponse).text;
  ok(prompt.includes(first.id));
  ok(prompt.includes(written.path));
  ok(prompt.includes('terrific events'));

  const full = await call(handle, 'GET', `${sessionPromptPath(first.id)}?kind=full`);
  equal(full.status, 200);
  equal((full.value as PromptResponse).text, text);

  const renamed = await call(handle, 'PATCH', sessionPath(first.id), { name: 'renamed first' });
  equal(renamed.status, 200);
  equal((renamed.value as SessionView).name, 'renamed first');
  const afterRename = await call(handle, 'GET', sessionPath(first.id));
  equal((afterRename.value as SessionDetail).name, 'renamed first');

  const running = await startNamed('still-on');
  const blocked = await call(handle, 'DELETE', sessionPath(running.id));
  equal(blocked.status, 409);
  equal(errorMessage(blocked.value), 'Stop the session first.');
  equal((await call(handle, 'POST', sessionStopPath(running.id))).status, 200);

  const removed = await call(handle, 'DELETE', sessionPath(first.id));
  equal(removed.status, 200);
  const afterDelete = (await call(handle, 'GET', sessionsPath(project.id)))
    .value as SessionListItem[];
  equal(
    afterDelete.some((item) => item.id === first.id),
    false,
  );
  ok(afterDelete.some((item) => item.id === second.id));

  const patched = await call(handle, 'PATCH', projectSettingsPath(project.id), {
    pinned: [second.id],
  });
  equal(patched.status, 200);
  const settings = await call(handle, 'GET', projectSettingsPath(project.id));
  equal(settings.status, 200);
  deepEqual((settings.value as ProjectSettingsView).pinned, [second.id]);

  const legacy = await seedLegacy(dataRoot, project.cwd);
  const withLegacy = (await call(handle, 'GET', sessionsPath(project.id)))
    .value as SessionListItem[];
  ok(withLegacy.some((item) => item.id === legacy.workspaceId && item.legacy === true));
  equal(
    withLegacy.some((item) => item.id === legacy.globalId),
    false,
  );

  const globalList = await call(handle, 'GET', legacySessionsPath());
  equal(globalList.status, 200);
  const globals = globalList.value as SessionListItem[];
  equal(globals.length, 1);
  equal(globals[0]?.id, legacy.globalId);
  equal(globals[0]?.legacy, true);

  equal((await call(handle, 'GET', sessionPath(legacy.workspaceId))).status, 200);
  equal((await call(handle, 'GET', sessionPath(legacy.globalId))).status, 200);

  const legacyRename = await call(handle, 'PATCH', sessionPath(legacy.workspaceId), {
    name: 'nope',
  });
  equal(legacyRename.status, 409);
  equal(errorMessage(legacyRename.value), 'Legacy sessions are read only.');
  const legacyDelete = await call(handle, 'DELETE', sessionPath(legacy.globalId));
  equal(legacyDelete.status, 409);
  equal(errorMessage(legacyDelete.value), 'Legacy sessions are read only.');

  const before = await readdir(legacy.workspaceFolder);
  const legacyContext = await call(handle, 'POST', sessionContextPath(legacy.workspaceId));
  equal(legacyContext.status, 200);
  const cached = legacyContext.value as ContextResponse;
  ok(cached.path.includes(join('cache', 'legacy', legacy.workspaceId)));
  await readFile(cached.path, 'utf8');
  const after = await readdir(legacy.workspaceFolder);
  deepEqual(after, before);
});
