import { equal, match, ok } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
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

test('an unreachable start URL still starts the session and records the failure', {
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
  const events: EventInput[] = [];
  // Port 9 (discard) is closed on test machines, like a dev server that is not up yet.
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: 'http://127.0.0.1:9/',
    record: { actions: true, network: true, console: true },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: (event) => events.push(event),
  });
  try {
    ok(events.some((event) => event.kind === 'network' && event.phase === 'failed'));
  } finally {
    await recording.stop();
  }
});

function firstBrowser(t: { skip: (reason?: string) => void }) {
  const browser = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  })[0];
  if (browser === undefined) {
    t.skip('no Chromium-based browser installed');
    return undefined;
  }
  return browser;
}

function collectEvents(): {
  events: EventInput[];
  onEvent: (event: EventInput) => void;
  appendEvent: (event: EventInput) => Promise<{ id: string }>;
} {
  const events: EventInput[] = [];
  let n = 0;
  return {
    events,
    onEvent: (event) => {
      events.push(event);
    },
    appendEvent: async (event) => {
      events.push(event);
      n += 1;
      return { id: `ev_test_${n}` };
    },
  };
}

async function openComposer(page: Page): Promise<void> {
  await page.click('h1', { button: 'right', modifiers: ['Alt'] });
  await page.locator('terrific-composer .panel').waitFor({ state: 'visible' });
}

test('composer opens on Alt+right-click and stays closed on plain right-click', {
  timeout: 30_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: true, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await page.click('h1', { button: 'right' });
    equal(await page.locator('terrific-composer .panel').isVisible(), false);

    await openComposer(page);
    equal(await page.locator('terrific-composer .panel').isVisible(), true);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer Point tool submits a note without recording composer actions', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: true, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await page.locator('#email').waitFor();
    const actionsBefore = collected.events.filter((event) => event.kind === 'action').length;

    await openComposer(page);
    await page.locator('terrific-composer .tl', { hasText: 'Point' }).click();
    await page.locator('#email').click();
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('typed note body');
    await page.keyboard.press('Control+Enter');

    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'note'));
    const notes = collected.events.filter((event) => event.kind === 'note');
    equal(notes.length, 1);
    if (notes[0]?.kind === 'note') {
      equal(notes[0].author, 'tester');
      match(notes[0].text, /<pointed-section>\n- Selector: `[^`]+`\n- Element: `<[a-z]/);
      match(notes[0].text, /typed note body/);
    }
    const actionsAfter = collected.events.filter((event) => event.kind === 'action').length;
    equal(actionsAfter, actionsBefore);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer Screenshot and Snapshot tools append captures and store a bug with chips', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: true, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'screenshot'));
    const shot = collected.events.find((event) => event.kind === 'screenshot');
    equal(shot?.kind, 'screenshot');
    if (shot?.kind === 'screenshot') {
      const absolute = join(screenshotsDir, shot.file.replace(/^screenshots\//, ''));
      ok((await stat(absolute)).size > 0);
    }

    await page.locator('terrific-composer .tl', { hasText: 'Snapshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'snapshot'));
    equal(await page.locator('terrific-composer .ch.cap').count(), 2);

    await page.locator('terrific-composer .ed').click();
    await page.keyboard.press('Control+Shift+Enter');
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'bug'));
    const bugs = collected.events.filter((event) => event.kind === 'bug');
    equal(bugs.length, 1);
    if (bugs[0]?.kind === 'bug') {
      equal(bugs[0].author, 'tester');
      match(bugs[0].text ?? '', /@ss_[A-Za-z0-9_-]+\.png/);
      match(bugs[0].text ?? '', /@snapshot:ev_test_/);
    }
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer still opens and submits a note when actions are disabled', {
  timeout: 30_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('actions off note');
    await page.keyboard.press('Control+Enter');
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'note'));
    const note = collected.events.find((event) => event.kind === 'note');
    equal(note?.kind, 'note');
    if (note?.kind === 'note') {
      equal(note.author, 'tester');
      match(note.text, /actions off note/);
    }
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer stores an empty bug with null text', {
  timeout: 30_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.press('Control+Shift+Enter');
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'bug'));
    const bug = collected.events.find((event) => event.kind === 'bug');
    equal(bug?.kind, 'bug');
    if (bug?.kind === 'bug') {
      equal(bug.text, null);
      equal(bug.author, 'tester');
    }
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer draft survives reload with chips and without stealing focus', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await page.locator('#email').waitFor();
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('draft survives reload');
    await page.locator('terrific-composer .tl', { hasText: 'Point' }).click();
    await page.locator('#email').click();
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'screenshot'));
    await page.locator('terrific-composer .ch.cap').waitFor();
    equal(await page.locator('terrific-composer .ch.el').count(), 1);
    equal(await page.locator('terrific-composer .ch.cap').count(), 1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('terrific-composer .panel').waitFor({ state: 'visible' });
    match(
      (await page.locator('terrific-composer .ed').textContent()) ?? '',
      /draft survives reload/,
    );
    equal(await page.locator('terrific-composer .ch.el').count(), 1);
    equal(await page.locator('terrific-composer .ch.cap').count(), 1);
    equal(
      await page.evaluate(() => document.activeElement?.localName === 'terrific-composer'),
      false,
    );
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer draft survives navigation and marks missing element chips gone', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await page.locator('#email').waitFor();
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('draft on page two');
    await page.locator('terrific-composer .tl', { hasText: 'Point' }).click();
    await page.locator('#email').click();
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'screenshot'));
    await page.locator('terrific-composer .ch.cap').waitFor();

    await page.goto(`${site.url}/page2.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('terrific-composer .panel').waitFor({ state: 'visible' });
    match((await page.locator('terrific-composer .ed').textContent()) ?? '', /draft on page two/);
    equal(await page.locator('terrific-composer .ch.el').count(), 1);
    equal(await page.locator('terrific-composer .ch.el.gone').count(), 1);
    equal(await page.locator('terrific-composer .ch.cap').count(), 1);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer submit after reload clears the draft for the next open', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await page.locator('#email').waitFor();
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('submit after reload');
    await page.locator('terrific-composer .tl', { hasText: 'Point' }).click();
    await page.locator('#email').click();
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'screenshot'));
    // The event lands before the page receives the result; reload only once the chip exists.
    await page.locator('terrific-composer .ch.cap').waitFor();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('terrific-composer .panel').waitFor({ state: 'visible' });
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.press('Control+Enter');
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'note'));
    const notes = collected.events.filter((event) => event.kind === 'note');
    equal(notes.length, 1);
    if (notes[0]?.kind === 'note') {
      match(notes[0].text, /submit after reload/);
      match(notes[0].text, /<pointed-section>\n- Selector: `[^`]+`\n- Element: `<[a-z]/);
      match(notes[0].text, /@ss_[A-Za-z0-9_-]+\.png/);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('h1').waitFor();
    equal(await page.locator('terrific-composer .panel').isVisible(), false);
    await openComposer(page);
    equal((await page.locator('terrific-composer .ed').textContent())?.trim(), '');
    equal(await page.locator('terrific-composer .ch').count(), 0);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer Esc close keeps draft hidden across reload until reopened', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('closed draft text');
    await page.keyboard.press('Escape');
    // The panel fades out before it is hidden.
    await page.locator('terrific-composer .panel').waitFor({ state: 'hidden' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('h1').waitFor();
    equal(await page.locator('terrific-composer .panel').isVisible(), false);
    await openComposer(page);
    match((await page.locator('terrific-composer .ed').textContent()) ?? '', /closed draft text/);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer screenshot labels continue across reload', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'screenshot'));
    match((await page.locator('terrific-composer .ch.cap').textContent()) ?? '', /Screenshot 1/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('terrific-composer .panel').waitFor({ state: 'visible' });
    match((await page.locator('terrific-composer .ch.cap').textContent()) ?? '', /Screenshot 1/);
    await page.locator('terrific-composer .tl', { hasText: 'Screenshot' }).click();
    await waitFor(
      collected.events,
      (seen) => seen.filter((event) => event.kind === 'screenshot').length >= 2,
    );
    const labels = await page.locator('terrific-composer .ch.cap').allTextContents();
    equal(
      labels.some((label) => /Screenshot 1/.test(label)),
      true,
    );
    equal(
      labels.some((label) => /Screenshot 2/.test(label)),
      true,
    );
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer inserts a capture after selected text instead of replacing it', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .ed').click();
    await page.keyboard.type('keep this text');
    await page.keyboard.press('Control+A');
    await page.locator('terrific-composer .tl', { hasText: 'Snapshot' }).click();
    await page.locator('terrific-composer .ch').waitFor();
    match((await page.locator('terrific-composer .ed').textContent()) ?? '', /keep this text/);
    equal(await page.locator('terrific-composer .ch').count(), 1);
  } finally {
    await recording.stop();
    await site.close();
  }
});

test('composer copies chips as references and pastes them back as chips', {
  timeout: 60_000,
}, async (t) => {
  const browser = firstBrowser(t);
  if (browser === undefined) return;

  const site = await serveSite();
  const screenshotsDir = await mkdtemp(join(tmpdir(), 'terrific-shots-'));
  tempDirs.push(screenshotsDir);
  const collected = collectEvents();
  const recording = await startRecording({
    browser: { executablePath: browser.executablePath, userDataDir: null, headless: true },
    url: `${site.url}/`,
    record: { actions: false, network: false, console: false },
    screenshotsDir,
    random: (n) => randomBytes(n),
    onEvent: collected.onEvent,
    appendEvent: collected.appendEvent,
  });
  try {
    const page = recording.page;
    await openComposer(page);
    await page.locator('terrific-composer .tl', { hasText: 'Point' }).click();
    await page.locator('#email').click();
    await page.keyboard.type('after');
    await page.keyboard.press('Control+A');

    const copied = await page.evaluate(() => {
      const ed = document.querySelector('terrific-composer')?.shadowRoot?.querySelector('.ed');
      const data = new DataTransfer();
      ed?.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return {
        text: data.getData('text/plain'),
        rich: data.getData('application/x-terrific-segments+json'),
      };
    });
    match(copied.text, /^<pointed-section>\n- Selector: `#email`\n- Element: `<input id="email">`/);
    match(copied.text, /<\/pointed-section>\nafter$/);
    const rich = JSON.parse(copied.rich) as { type: string; reference?: string }[];
    equal(rich[0]?.type, 'element');
    match(rich[0]?.reference ?? '', /^<pointed-section>/);

    const paste = (text: string, richData?: string) =>
      page.evaluate(
        ([plain, segments]) => {
          const ed = document.querySelector('terrific-composer')?.shadowRoot?.querySelector('.ed');
          const data = new DataTransfer();
          data.setData('text/plain', plain ?? '');
          if (segments) data.setData('application/x-terrific-segments+json', segments);
          ed?.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
          );
        },
        [text, richData] as const,
      );

    // Rich paste restores the identical element chip.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await paste(copied.text, copied.rich);
    equal(await page.locator('terrific-composer .ch.el').count(), 1);

    // Plain text tokens become chips; malformed tokens stay text.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await paste(
      'see\n<pointed-section>\n- Selector: `#color`\n- Element: `<select id="color">`\n</pointed-section>\n@ss_abc123.png @snapshot:ev_xyz789 bad @ss_../x.png',
    );
    equal(await page.locator('terrific-composer .ch').count(), 3);
    await page.keyboard.press('Control+Enter');
    await waitFor(collected.events, (seen) => seen.some((event) => event.kind === 'note'));
    const note = collected.events.find((event) => event.kind === 'note');
    if (note?.kind === 'note') {
      match(note.text, /^see\n<pointed-section>\n- Selector: `#color`/);
      match(note.text, /@ss_abc123\.png @snapshot:ev_xyz789 bad @ss_\.\.\/x\.png$/);
    } else {
      ok(false, 'expected a note');
    }
  } finally {
    await recording.stop();
    await site.close();
  }
});
