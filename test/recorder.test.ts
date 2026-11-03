import { equal, match, ok } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EventInput } from '../src/core/events.ts';
import { findInstalledBrowsers } from '../src/recorder/browsers.ts';
import { startRecording } from '../src/recorder/recording.ts';

const SITE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site');
const tempDirs: string[] = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function serveSite(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const path = req.url === undefined ? '/' : (req.url.split('?')[0] ?? '/');
    if (path === '/api/ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/api/missing') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('missing');
      return;
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (file.includes('..')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await readFile(join(SITE, file));
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
      res.writeHead(200, { 'content-type': type });
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

async function waitFor(
  events: EventInput[],
  check: (events: EventInput[]) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check(events)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for recorder events: ${JSON.stringify(events, null, 2)}`);
}

function actions(events: EventInput[], action: string): EventInput[] {
  return events.filter((event) => event.kind === 'action' && event.action === action);
}

function expectedEventsReady(seen: EventInput[]): boolean {
  const email = actions(seen, 'input').some(
    (event) => event.kind === 'action' && event.value === 'qa@example.com',
  );
  const password = actions(seen, 'input').some(
    (event) => event.kind === 'action' && event.masked && event.valueLength === 6,
  );
  const select = actions(seen, 'select').some(
    (event) => event.kind === 'action' && event.value === 'Blue',
  );
  const checkbox = actions(seen, 'change').some(
    (event) => event.kind === 'action' && event.value === 'checked',
  );
  const post = seen.find(
    (event) =>
      event.kind === 'network' &&
      event.phase === 'request' &&
      event.method === 'POST' &&
      event.url.includes('/api/ok') &&
      event.requestBody === '{"a":1}',
  );
  const postOk =
    post?.kind === 'network' &&
    seen.some(
      (event) =>
        event.kind === 'network' &&
        event.phase === 'response' &&
        event.requestId === post.requestId &&
        event.status === 200 &&
        event.responseBody?.includes('ok'),
    );
  const notFound = seen.some(
    (event) => event.kind === 'network' && event.phase === 'response' && event.status === 404,
  );
  const failed = seen.some(
    (event) =>
      event.kind === 'network' && event.phase === 'failed' && event.url.includes('127.0.0.1:9'),
  );
  const warn = seen.some(
    (event) =>
      event.kind === 'console' && event.level === 'warn' && event.text.includes('fixture warn'),
  );
  const error = seen.some(
    (event) =>
      event.kind === 'console' && event.level === 'error' && event.text.includes('fixture error'),
  );
  const nav = seen.some((event) => event.kind === 'navigation' && event.url.includes('page2.html'));
  return (
    email &&
    password &&
    select &&
    checkbox &&
    actions(seen, 'submit').length > 0 &&
    actions(seen, 'click').length > 0 &&
    Boolean(postOk) &&
    notFound &&
    failed &&
    warn &&
    error &&
    nav
  );
}

test('recorder captures actions, network, console, navigation, snapshot and screenshot', {
  timeout: 60_000,
}, async (t) => {
  const installed = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
  const browser = installed[0];
  if (browser === undefined) {
    t.skip('no Chromium-based browser installed');
    return;
  }

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const events: EventInput[] = [];
  const recording = await startRecording({
    browser: {
      executablePath: browser.executablePath,
      userDataDir: null,
      headless: true,
    },
    url: `${site.url}/`,
    record: { actions: true, network: true, console: true },
    screenshotsDir,
    random: (bytes) => randomBytes(bytes),
    onEvent: (event) => {
      events.push(event);
    },
  });

  try {
    const page = recording.page;
    await page.locator('#email').fill('qa@example.com');
    await page.locator('#password').fill('s3cret');
    await page.locator('#color').selectOption('blue');
    await page.locator('#agree').check();
    await page.locator('#submit').click();
    await page.locator('#missing').click();
    await page.locator('#fail').click();
    await page.locator('#next').click();

    await waitFor(events, expectedEventsReady);

    const password = actions(events, 'input').find(
      (event) => event.kind === 'action' && event.masked,
    );
    equal(password?.kind, 'action');
    if (password?.kind === 'action') {
      equal(password.value, undefined);
      equal(password.valueLength, 6);
    }

    const snapshot = await recording.snapshot();
    equal(snapshot.kind, 'snapshot');
    if (snapshot.kind === 'snapshot') {
      match(snapshot.markdown, /Second page/);
    }

    const shotPath = await recording.screenshot();
    const info = await stat(shotPath);
    ok(info.size > 0);
    const bytes = await readFile(shotPath);
    equal(bytes[0], 0x89);
    equal(bytes[1], 0x50);
    equal(bytes[2], 0x4e);
    equal(bytes[3], 0x47);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('closing the browser from outside resolves closed with browser-closed', {
  timeout: 30_000,
}, async (t) => {
  const browser = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  })[0];
  if (browser === undefined) {
    t.skip('no Chromium-based browser installed');
    return;
  }
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: '',
    record: { actions: true, network: true, console: true },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: () => {},
  });
  // Closing the context is what the tester closing the browser window looks like to Playwright.
  await recording.context.close();
  equal(await recording.closed, 'browser-closed');
  await recording.stop();
  equal(await recording.closed, 'browser-closed');
});
