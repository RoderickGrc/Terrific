import { equal, match, ok } from 'node:assert/strict';
import { getRandomValues } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CaptureResponse,
  type EndpointView,
  endpointEventsPath,
  endpointPath,
  endpointsPath,
  type MarkResponse,
  type ProjectView,
  resolveProjectPath,
  type SessionView,
  sessionMarksPath,
  sessionScreenshotPath,
  sessionStopPath,
  sessionsPath,
  statusPath,
} from '../src/core/api.ts';
import type { IngestEvent, TerrificEvent } from '../src/core/events.ts';
import type { RandomSource } from '../src/core/ids.ts';
import type { SessionSetup } from '../src/core/setup.ts';
import { type DaemonHandle, startDaemon } from '../src/daemon/daemon.ts';
import { findInstalledBrowsers } from '../src/recorder/browsers.ts';

const SITE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site');
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
  const dir = await mkdtemp(join(tmpdir(), 'terrific-sessions-'));
  dirs.push(dir);
  return dir;
}

function random(): RandomSource {
  return (n) => getRandomValues(new Uint8Array(n));
}

async function start(root?: string, now?: () => Date) {
  const dataRoot = root ?? (await tempRoot());
  const handle = await startDaemon({
    dataRoot,
    port: 0,
    appVersion: '0.0.0-test',
    now: now ?? (() => new Date()),
    random: random(),
    maintenanceIntervalMs: 60_000,
    headless: true,
  });
  handles.push(handle);
  return { handle, dataRoot };
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

async function readEvents(file: string): Promise<TerrificEvent[]> {
  const text = await readFile(file, 'utf8');
  const events: TerrificEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    events.push(JSON.parse(line) as TerrificEvent);
  }
  return events;
}

async function waitForEvents(
  file: string,
  check: (events: TerrificEvent[]) => boolean,
  timeoutMs = 15_000,
): Promise<TerrificEvent[]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const events = await readEvents(file);
      if (check(events)) return events;
    } catch {
      // The file may still be empty.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for session events in ${file}`);
}

async function serveSite(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const path = req.url === undefined ? '/' : (req.url.split('?')[0] ?? '/');
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (file.includes('..')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await readFile(join(SITE, file));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server did not bind a port');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function noneSetup(endpoint: string | null): SessionSetup {
  return {
    target: 'none',
    url: '',
    profile: 'clean',
    record: { actions: false, network: false, console: false },
    endpoint,
  };
}

function browserSetup(url: string, endpoint: string): SessionSetup {
  return {
    target: 'browser',
    url,
    profile: 'clean',
    record: { actions: true, network: true, console: true },
    endpoint,
  };
}

test('browser session: endpoint link, ingest copy, marks, screenshot, stop', {
  timeout: 60_000,
}, async (t) => {
  const installed = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
  if (installed[0] === undefined) {
    t.skip('no Chromium-based browser installed');
    return;
  }

  const site = await serveSite();
  const { handle } = await start();
  try {
    const cwd = await tempRoot();
    const project = (await call(handle, 'POST', resolveProjectPath(), { cwd }))
      .value as ProjectView;
    const created = (await call(handle, 'POST', endpointsPath(project.id), { name: 'app' }))
      .value as EndpointView;
    await new Promise((resolve) => setTimeout(resolve, 120));

    const started = await call(handle, 'POST', sessionsPath(project.id), {
      name: 'fullstack',
      setup: browserSetup(`${site.url}/`, 'app'),
    });
    equal(started.status, 201);
    const session = started.value as SessionView;
    equal(session.endpoint?.url, created.url);
    equal(session.status, 'recording');

    await waitForEvents(session.files.events, (events) =>
      events.some((event) => event.kind === 'navigation'),
    );

    const posted = await fetch(created.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'from-app' }),
    });
    equal(posted.status, 202);

    const sessionEvents = await waitForEvents(session.files.events, (events) =>
      events.some((event) => event.kind === 'ingest' && event.message === 'from-app'),
    );
    const copied = sessionEvents.find((event) => event.kind === 'ingest');
    if (copied === undefined || copied.kind !== 'ingest') {
      throw new Error('expected a copied ingest event');
    }
    const endpointEvents = (await call(handle, 'GET', endpointEventsPath(project.id, 'app')))
      .value as IngestEvent[];
    const original = endpointEvents[0];
    if (original === undefined) throw new Error('expected an endpoint ingest event');
    equal(copied.id !== original.id, true);
    ok(copied.t >= 0);
    ok(copied.t < original.t);

    const bug = await call(handle, 'POST', sessionMarksPath(session.id), {
      kind: 'bug',
      text: null,
    });
    equal(bug.status, 200);
    const note = await call(handle, 'POST', sessionMarksPath(session.id), {
      kind: 'note',
      text: 'check pooling',
    });
    equal(note.status, 200);
    ok(typeof (note.value as MarkResponse).id === 'string');

    const shot = await call(handle, 'POST', sessionScreenshotPath(session.id));
    equal(shot.status, 200);
    const capture = shot.value as CaptureResponse;
    if (capture.file === undefined) throw new Error('expected a screenshot file');
    await access(capture.file);

    const stopped = await call(handle, 'POST', sessionStopPath(session.id), {
      name: 'pooling interval check',
    });
    equal(stopped.status, 200);
    const after = stopped.value as SessionView;
    equal(after.status, 'stopped');
    equal(after.name, 'pooling interval check');
    equal(after.endpoint?.state, 'open');
    const context = await readFile(after.files.context, 'utf8');
    match(context, /BUG/);

    const again = await call(handle, 'POST', sessionStopPath(session.id), {});
    equal(again.status, 200);
    equal((again.value as SessionView).status, 'stopped');
    equal((again.value as SessionView).name, 'pooling interval check');
  } finally {
    await site.close();
  }
});

test('no-browser session: flag, screenshot 400, stop', async () => {
  const { handle } = await start();
  const cwd = await tempRoot();
  const project = (await call(handle, 'POST', resolveProjectPath(), { cwd })).value as ProjectView;
  const started = await call(handle, 'POST', sessionsPath(project.id), {
    name: null,
    setup: noneSetup('main'),
  });
  equal(started.status, 201);
  const session = started.value as SessionView;
  equal(session.endpoint?.name, 'main');
  match(session.endpoint?.url ?? '', /\/ingest\/ing_/);

  const flag = await call(handle, 'POST', sessionMarksPath(session.id), {
    kind: 'flag',
    text: null,
  });
  equal(flag.status, 200);

  const shot = await call(handle, 'POST', sessionScreenshotPath(session.id));
  equal(shot.status, 400);
  equal(errorMessage(shot.value), 'This session has no browser.');

  const blocked = await call(handle, 'POST', sessionsPath(project.id), {
    name: null,
    setup: { ...browserSetup('http://127.0.0.1/', 'main'), profile: 'work' },
  });
  equal(blocked.status, 400);
  match(errorMessage(blocked.value), /No browser profile called "work"/);

  const stopped = await call(handle, 'POST', sessionStopPath(session.id), {});
  equal(stopped.status, 200);
  equal((stopped.value as SessionView).status, 'stopped');
});

test('restart marks a still-recording session interrupted', async () => {
  const dataRoot = await tempRoot();
  const first = await start(dataRoot);
  const cwd = await tempRoot();
  const project = (await call(first.handle, 'POST', resolveProjectPath(), { cwd }))
    .value as ProjectView;
  const started = await call(first.handle, 'POST', sessionsPath(project.id), {
    name: 'notes',
    setup: noneSetup('main'),
  });
  const session = started.value as SessionView;
  equal(session.status, 'recording');
  await first.handle.close({ stopSessions: false });

  const second = await start(dataRoot);
  const meta = JSON.parse(await readFile(join(session.folder, 'session.json'), 'utf8')) as {
    status: string;
  };
  equal(meta.status, 'interrupted');
  const events = await readEvents(session.files.events);
  const last = events[events.length - 1];
  equal(last?.kind, 'lifecycle');
  if (last?.kind === 'lifecycle') equal(last.state, 'interrupted');
  const status = await call(second.handle, 'GET', statusPath());
  equal(status.status, 200);
  equal((status.value as { sessions: SessionView[] }).sessions.length, 0);
});

test('the endpoint of a running session cannot be closed, renamed or deleted', async () => {
  const { handle } = await start();
  const cwd = await tempRoot();
  const project = (await call(handle, 'POST', resolveProjectPath(), { cwd })).value as ProjectView;
  const started = await call(handle, 'POST', sessionsPath(project.id), {
    name: null,
    setup: noneSetup('main'),
  });
  const session = started.value as SessionView;
  const removed = await call(handle, 'DELETE', endpointPath(project.id, 'main'));
  equal(removed.status, 409);
  match(errorMessage(removed.value), /linked/);
  const closed = await call(handle, 'POST', `${endpointPath(project.id, 'main')}/close`);
  equal(closed.status, 409);
  const renamed = await call(handle, 'POST', `${endpointPath(project.id, 'main')}/rename`, {
    name: 'other',
  });
  equal(renamed.status, 409);
  // No body at all: agents and curl can stop a session without sending `{}`.
  const stopped = await call(handle, 'POST', sessionStopPath(session.id));
  equal(stopped.status, 200);
  equal((stopped.value as SessionView).status, 'stopped');
  const closedAfter = await call(handle, 'POST', `${endpointPath(project.id, 'main')}/close`);
  equal(closedAfter.status, 200);
});
