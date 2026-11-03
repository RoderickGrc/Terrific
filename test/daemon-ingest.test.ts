import { deepEqual, equal, match } from 'node:assert/strict';
import { getRandomValues } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  closeEndpointPath,
  type EndpointView,
  endpointEventsPath,
  endpointPath,
  endpointStreamPath,
  endpointsPath,
  type HealthView,
  healthPath,
  ingestPath,
  type ProjectView,
  renameEndpointPath,
  resolveProjectPath,
} from '../src/core/api.ts';
import { dataPaths } from '../src/core/data-root.ts';
import { isTerrificError } from '../src/core/errors.ts';
import type { IngestEvent } from '../src/core/events.ts';
import type { RandomSource } from '../src/core/ids.ts';
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
  const dir = await mkdtemp(join(tmpdir(), 'terrific-daemon-'));
  dirs.push(dir);
  return dir;
}

function random(): RandomSource {
  return (n) => getRandomValues(new Uint8Array(n));
}

function clock(start = '2026-06-01T00:00:00.000Z') {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms),
    advance(deltaMs: number) {
      ms += deltaMs;
    },
  };
}

async function start(port = 0, root?: string, now?: () => Date) {
  const dataRoot = root ?? (await tempRoot());
  const handle = await startDaemon({
    dataRoot,
    port,
    appVersion: '0.0.0-test',
    now: now ?? (() => new Date('2026-06-01T00:00:00.000Z')),
    random: random(),
    maintenanceIntervalMs: 60_000,
  });
  handles.push(handle);
  return { handle, dataRoot };
}

async function call(
  handle: DaemonHandle,
  method: string,
  path: string,
  body?: unknown,
  extra?: Record<string, string>,
  auth = true,
): Promise<{ status: number; value: unknown; headers: Headers }> {
  const headers: Record<string, string> = { ...extra };
  if (auth) headers.Authorization = `Bearer ${handle.token}`;
  let payload: string | undefined;
  if (body !== undefined) {
    if (headers['content-type'] === undefined) headers['content-type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${handle.url}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let value: unknown = text;
  if (text !== '') {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { status: res.status, value, headers: res.headers };
}

function asEndpoint(value: unknown): EndpointView {
  return value as EndpointView;
}

function errorMessage(value: unknown): string {
  const record = value as { error?: { message?: string } };
  return record.error?.message ?? '';
}

function errorCode(value: unknown): string {
  const record = value as { error?: { code?: string } };
  return record.error?.code ?? '';
}

function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, setHost: false, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('health requires the token and rejects a foreign Host', async () => {
  const { handle } = await start();
  const missing = await call(handle, 'GET', healthPath(), undefined, undefined, false);
  equal(missing.status, 401);
  const okRes = await call(handle, 'GET', healthPath());
  equal(okRes.status, 200);
  const health = okRes.value as HealthView;
  equal(health.appVersion, '0.0.0-test');
  equal(health.port, handle.port);
  equal(health.pid, process.pid);
  const foreign = await rawRequest(handle.port, healthPath(), {
    Host: `evil.example:${handle.port}`,
    Authorization: `Bearer ${handle.token}`,
  });
  equal(foreign.status, 421);
});

test('ingest lifecycle: up, post, close, reopen, rename, delete', async () => {
  const { handle } = await start();
  const cwd = await tempRoot();
  const first = await call(handle, 'POST', resolveProjectPath(), { cwd });
  const second = await call(handle, 'POST', resolveProjectPath(), { cwd });
  equal(first.status, 200);
  equal((first.value as ProjectView).id, (second.value as ProjectView).id);
  const projectId = (first.value as ProjectView).id;

  const created = asEndpoint(
    (await call(handle, 'POST', endpointsPath(projectId), { name: 'app' })).value,
  );
  const again = asEndpoint(
    (await call(handle, 'POST', endpointsPath(projectId), { name: 'app' })).value,
  );
  equal(created.url, again.url);
  const urlPrefix = `http://127.0.0.1:${handle.port}/ingest/ing_`;
  equal(created.url.startsWith(urlPrefix), true);

  const posted = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
  });
  equal(posted.status, 202);
  const eventsPath = endpointEventsPath(projectId, 'app');
  const list = (await call(handle, 'GET', eventsPath)).value as IngestEvent[];
  equal(list.length, 1);
  equal(list[0]?.message, 'hello');
  equal(list[0]?.endpoint, 'app');

  const plain = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ message: 'plain' }),
  });
  equal(plain.status, 202);
  equal(plain.headers.get('access-control-allow-origin'), '*');

  // `curl -d` sends form encoding; the body is still JSON and must be accepted.
  const form = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ message: 'form' }),
  });
  equal(form.status, 202);

  const preflight = await fetch(created.url, { method: 'OPTIONS' });
  equal(preflight.status, 204);
  equal(preflight.headers.get('access-control-allow-origin'), '*');
  equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  equal(preflight.headers.get('access-control-allow-headers'), 'content-type');

  const invalid = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  equal(invalid.status, 400);
  match(errorMessage(await invalid.json()), /message/);

  const closed = asEndpoint(
    (await call(handle, 'POST', closeEndpointPath(projectId, 'app'))).value,
  );
  equal(closed.state, 'closed');
  const afterClose = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'late' }),
  });
  equal(afterClose.status, 410);
  equal(errorCode(await afterClose.json()), 'ENDPOINT_CLOSED');
  const still = (await call(handle, 'GET', eventsPath)).value as IngestEvent[];
  equal(still.length, 3);

  const reopened = asEndpoint(
    (await call(handle, 'POST', endpointsPath(projectId), { name: 'app' })).value,
  );
  equal(reopened.url, created.url);
  equal(reopened.state, 'open');

  const renamed = asEndpoint(
    (await call(handle, 'POST', renameEndpointPath(projectId, 'app'), { name: 'api' })).value,
  );
  equal(renamed.url, created.url);
  equal(renamed.name, 'api');
  equal((await call(handle, 'GET', eventsPath)).status, 404);
  const apiEvents = endpointEventsPath(projectId, 'api');
  equal((await call(handle, 'GET', apiEvents)).status, 200);

  const removed = await call(handle, 'DELETE', endpointPath(projectId, 'api'));
  deepEqual(removed.value, { ok: true });
  const gone = await fetch(created.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'after-delete' }),
  });
  equal(gone.status, 404);

  const unknownUrl = `${handle.url}${ingestPath('ing_notarealtoken0000000001')}`;
  const unknown = await fetch(unknownUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'nope' }),
  });
  equal(unknown.status, 404);
});

test('parallel posts are all stored, in order, with their own seq', async () => {
  const { handle } = await start();
  const cwd = await tempRoot();
  const projectId = (
    (await call(handle, 'POST', resolveProjectPath(), { cwd })).value as ProjectView
  ).id;
  const created = asEndpoint(
    (await call(handle, 'POST', endpointsPath(projectId), { name: 'burst' })).value,
  );
  const statuses = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      fetch(created.url, { method: 'POST', body: JSON.stringify({ message: `m${i}` }) }).then(
        (res) => res.status,
      ),
    ),
  );
  deepEqual([...new Set(statuses)], [202]);
  const list = (await call(handle, 'GET', `${endpointEventsPath(projectId, 'burst')}?limit=100`))
    .value as IngestEvent[];
  equal(list.length, 40);
  deepEqual(
    list.map((event) => event.seq),
    Array.from({ length: 40 }, (_, i) => i),
  );
  const views = (await call(handle, 'GET', endpointsPath(projectId))).value as EndpointView[];
  equal(views.find((view) => view.name === 'burst')?.eventCount, 40);
});

test('SSE subscriber receives an ingest event posted after it subscribed', async () => {
  const { handle } = await start();
  const cwd = await tempRoot();
  const resolved = await call(handle, 'POST', resolveProjectPath(), { cwd });
  const project = resolved.value as ProjectView;
  const endpoint = asEndpoint(
    (await call(handle, 'POST', endpointsPath(project.id), { name: 'app' })).value,
  );
  const ac = new AbortController();
  const stream = await fetch(`${handle.url}${endpointStreamPath(project.id, 'app')}`, {
    headers: { Authorization: `Bearer ${handle.token}` },
    signal: ac.signal,
  });
  equal(stream.status, 200);
  match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = stream.body?.getReader();
  if (reader === undefined) throw new Error('SSE response has no body');
  const posted = fetch(endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'streamed' }),
  });
  const decoder = new TextDecoder();
  let buf = '';
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !buf.includes('event: ingest')) {
      const read = await reader.read();
      if (read.done) break;
      buf += decoder.decode(read.value, { stream: true });
    }
  } finally {
    ac.abort();
  }
  equal((await posted).status, 202);
  match(buf, /event: ingest/);
  match(buf, /streamed/);
});

test('maintenance closes an idle endpoint', async () => {
  const time = clock();
  const { handle } = await start(0, undefined, time.now);
  const cwd = await tempRoot();
  const resolved = await call(handle, 'POST', resolveProjectPath(), { cwd });
  const project = resolved.value as ProjectView;
  await call(handle, 'POST', endpointsPath(project.id), { name: 'app' });
  time.advance(24 * 60 * 60 * 1000 + 1);
  await handle.runMaintenance();
  const listed = (await call(handle, 'GET', endpointsPath(project.id))).value as EndpointView[];
  equal(listed[0]?.state, 'closed');
  equal(listed[0]?.closedReason, 'idle');
});

test('restart reuses the token file and endpoint URL token', async () => {
  const dataRoot = await tempRoot();
  const first = await start(0, dataRoot);
  const cwd = await tempRoot();
  const resolved = await call(first.handle, 'POST', resolveProjectPath(), { cwd });
  const project = resolved.value as ProjectView;
  const created = asEndpoint(
    (await call(first.handle, 'POST', endpointsPath(project.id), { name: 'app' })).value,
  );
  const tokenOnDisk = (await readFile(dataPaths(dataRoot).tokenFile, 'utf8')).trim();
  equal(tokenOnDisk, first.handle.token);
  const ingestToken = new URL(created.url).pathname;
  await first.handle.close();
  const second = await start(first.handle.port, dataRoot);
  equal(second.handle.token, first.handle.token);
  const afterRestart = await call(second.handle, 'GET', endpointsPath(project.id));
  const listed = afterRestart.value as EndpointView[];
  const view = listed[0];
  if (view === undefined) throw new Error('expected the endpoint to survive restart');
  equal(view.state, 'open');
  equal(new URL(view.url).pathname, ingestToken);
});

test('a second daemon on a busy port fails with the port-in-use message', async () => {
  const first = await start(0);
  try {
    await startDaemon({
      dataRoot: await tempRoot(),
      port: first.handle.port,
      appVersion: '0.0.0-test',
      now: () => new Date('2026-06-01T00:00:00.000Z'),
      random: random(),
    });
    throw new Error('expected port-in-use failure');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) {
      match(error.message, /in use/);
      match(error.message, /TERRIFIC_PORT/);
      match(error.message, new RegExp(`Port ${first.handle.port}`));
    }
  }
});
