import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { StartSessionRequest } from '../src/core/api.ts';
import { detachedMessage, loadInitial, type MountedTui, mountTui } from '../src/tui/run.ts';
import { createFakeDaemon, type FakeDaemon, PROJECT } from './helpers/fake-daemon-client.ts';
import { VirtualTerminal } from './helpers/virtual-terminal.ts';

const SIZES = [
  { columns: 110, rows: 34 },
  { columns: 80, rows: 24 },
] as const;

const ENTER = '\r';
const ESC = '\x1b';
const CTRL_C = '\x03';
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const CTRL_ENTER = '\x1b[13;5u';
const CTRL_SHIFT_ENTER = '\x1b[13;6u';
const CTRL_N = '\x0e';
const CTRL_R = '\x12';
const CTRL_D = '\x04';
const CTRL_U = '\x15';
const RIGHT = '\x1b[C';

type Harness = {
  term: VirtualTerminal;
  fake: FakeDaemon;
  tui: MountedTui;
  type(text: string): void;
};

// The open TUI, quit after each test so a failed assertion does not leave it running.
let current: Harness | undefined;

async function open(
  columns = 110,
  rows = 34,
  prepare?: (fake: FakeDaemon) => Promise<void>,
  refreshMs?: number,
): Promise<Harness> {
  const fake = createFakeDaemon();
  await prepare?.(fake);
  const term = new VirtualTerminal(columns, rows);
  const initial = await loadInitial(fake.client, PROJECT.cwd, '/data');
  const tui = mountTui(term, fake.client, initial, { color: false, refreshMs });
  const type = (text: string): void => {
    for (const ch of text) term.send(ch);
  };
  current = { term, fake, tui, type };
  return current;
}

// The first Ctrl+C closes an open panel, if any; two more quit.
async function quit(h: Harness): Promise<void> {
  h.term.send(CTRL_C);
  h.term.send(CTRL_C);
  h.term.send(CTRL_C);
  await h.tui.done;
}

function calls(h: Harness, method: string): unknown[][] {
  return h.fake.calls.filter((call) => call.method === method).map((call) => call.args);
}

/** Waits until the screen shows `pattern`, for steps that take a few daemon round trips. */
async function screenWith(h: Harness, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 2000;
  let text = await h.term.text();
  while (!pattern.test(text) && Date.now() < deadline) text = await h.term.text();
  return text;
}

async function startSession(h: Harness, line: string): Promise<string> {
  h.type(line);
  h.term.send(ENTER);
  await h.term.lines();
  h.term.send(ENTER);
  await h.term.lines();
  const started = calls(h, 'startSession');
  ok(started.length > 0, 'startSession was called');
  return `s-new-${started.length}`;
}

describe('tui', () => {
  afterEach(async () => {
    if (current !== undefined) await quit(current);
    current = undefined;
  });

  for (const { columns, rows } of SIZES) {
    test(`home shows the project, its endpoints and only what is recording at ${columns}x${rows}`, async () => {
      const h = await open(columns, rows);
      const lines = await h.term.lines();
      match(lines[0] ?? '', /^ Terrific {2}acme-shop .*no session $/);
      match(lines[1] ?? '', /Project \/work\/acme-shop .*READY/);
      const text = lines.join('\n');
      match(text, /Ingest {3}● app 3 events/);
      match(text, /○ worker closed/);
      match(text, /Recording {2}in this project/);
      match(text, /Nothing recording\. \/new starts one/);
      ok(!text.includes('s-checkout'), 'stopped sessions stay in /sessions');
      match(text, /Type a command\. \/new starts a session/);
      equal((lines[rows - 2] ?? '').trim(), '');
      await quit(h);
    });

    test(`the live screen keeps its header and input at ${columns}x${rows}`, async () => {
      const h = await open(columns, rows);
      const id = await startSession(h, '/new localhost:5173 cart check');
      for (let i = 0; i < 60; i += 1) {
        h.fake.emit(id, { kind: 'console', level: 'log', text: `tick ${i}` }, 1000 + i * 100);
      }
      const lines = await h.term.lines();
      match(lines[0] ?? '', /s-new-1 • 00:0\d $/);
      match(lines[1] ?? '', /Session cart check {2}Profile Clean browser {2}Ingest app .*● REC/);
      ok(
        lines.some((l) => l.includes('tick 59')),
        'the newest event is visible',
      );
      ok(!lines.some((l) => l.includes('tick 0 ')), 'old events scrolled away');
      match(lines[rows - 3] ?? '', /60 events · 0 network · 0 actions · 60 console/);
      await quit(h);
    });
  }

  test('/new shows how the line is read, then confirms and starts the session', async () => {
    const h = await open();
    h.type('/new localhost:5173 pooling check @te');
    let text = await h.term.text();
    match(text, /URL {7}localhost:5173/);
    match(text, /Name {6}pooling check/);
    match(text, /! @te {2}incomplete profile/);
    match(text, /› @testing {18}Microsoft Edge · keeps logins and data/);
    h.term.send('\t');
    text = await h.term.text();
    match(text, /› \/new localhost:5173 pooling check @testing/);
    h.term.send(ENTER);
    text = await h.term.text();
    match(text, /Confirm new session/);
    match(text, /Enter starts now: opens localhost:5173 with testing, linked to ingest app/);
    h.term.send(ENTER);
    await h.term.lines();
    const [body] = calls(h, 'startSession')[0] as [StartSessionRequest];
    deepEqual(body, {
      setup: {
        target: 'browser',
        url: 'http://localhost:5173',
        profile: 'testing',
        record: { actions: true, network: true, console: true },
        endpoint: 'app',
      },
      name: 'pooling check',
    });
    const saved = calls(h, 'patchSettings').at(-1)?.[0] as { lastSetup: { profile: string } };
    equal(saved.lastSetup.profile, 'testing');
    await quit(h);
  });

  test('the confirmation edits fields and refuses a URL that is not one yet', async () => {
    const h = await open();
    h.type('/new');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /Name .*\n.*Target .*\n.*URL /);
    h.term.send(DOWN);
    h.term.send(DOWN);
    h.term.send('\x15');
    h.type('htp:/x');
    text = await h.term.text();
    match(text, /not a URL yet/);
    h.term.send(ENTER);
    text = await h.term.text();
    match(text, /The URL does not look right/);
    equal(calls(h, 'startSession').length, 0);
    h.term.send(UP);
    h.term.send('\x1b[C');
    text = await h.term.text();
    match(text, /Enter starts now: records without a browser, linked to ingest app/);
    h.term.send(ESC);
    text = await h.term.text();
    match(text, /Recording {2}in this project/);
    await quit(h);
  });

  test('a request and its response share one log line', async () => {
    const h = await open();
    const id = await startSession(h, '/new localhost:5173');
    const request = {
      kind: 'network',
      requestId: 'r1',
      method: 'GET',
      url: 'http://localhost:5173/api/cart',
    } as const;
    h.fake.emit(id, { ...request, phase: 'request' }, 1500);
    let lines = await h.term.lines();
    ok(
      lines.some((l) => /net {5}GET localhost:5173\/api\/cart +··· +$/.test(l)),
      'pending request',
    );
    h.fake.emit(id, { ...request, phase: 'response', status: 500, durationMs: 42 }, 1542);
    lines = await h.term.lines();
    equal(lines.filter((l) => l.includes('api/cart')).length, 1);
    ok(
      lines.some((l) => /api\/cart +500 42ms +$/.test(l)),
      'status and duration in place',
    );
    await quit(h);
  });

  test('notes, bugs and flags go to the daemon, with or without text', async () => {
    const h = await open();
    const id = await startSession(h, '/new localhost:5173');
    h.type('cart total is wrong');
    h.term.send(ENTER);
    h.type('coupon ignored');
    h.term.send(CTRL_ENTER);
    h.term.send(CTRL_SHIFT_ENTER);
    h.type('/flag slow page');
    h.term.send(ENTER);
    const text = await h.term.text();
    deepEqual(
      calls(h, 'addMark').map(([sessionId, body]) => [sessionId, body]),
      [
        [id, { kind: 'note', text: 'cart total is wrong' }],
        [id, { kind: 'bug', text: 'coupon ignored' }],
        [id, { kind: 'flag', text: null }],
        [id, { kind: 'flag', text: 'slow page' }],
      ],
    );
    match(text, /note {4}cart total is wrong/);
    match(text, /flag {4}Flagged point of interest/);
    match(text, /1 note · 1 bug · 2 flags/);
    await quit(h);
  });

  test('/stop confirms with an editable name and opens the summary', async () => {
    const h = await open();
    const id = await startSession(h, '/new localhost:5173 first try');
    h.fake.emit(id, { kind: 'bug', text: 'Total ignores the coupon', author: 'tester' }, 4000);
    h.type('/stop');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /Stop recording\?/);
    match(text, /Ingest app stays open/);
    match(text, /› first try/);
    h.term.send(ESC);
    text = await h.term.text();
    match(text, /Still recording/);
    equal(calls(h, 'stopSession').length, 0);
    h.type('/stop');
    h.term.send(ENTER);
    h.type('coupon bug');
    h.term.send(ENTER);
    text = await screenWith(h, /STOPPED/);
    deepEqual(calls(h, 'stopSession'), [[id, { name: 'coupon bug' }]]);
    match(text, /Session coupon bug .*STOPPED/);
    match(text, /Context +4.0 KB/);
    match(text, /● 1 bug to review {2}· {2}no errors/);
    match(text, /To review {2}00:04\.0 {2}bug {3}Total ignores the coupon/);
    match(text, /Same setup: \/new localhost:5173 @clean #app/);
    h.term.send(ESC);
    text = await h.term.text();
    match(text, /Recording {2}in this project/);
    await quit(h);
  });

  test('a session stopped from elsewhere leaves the live screen for its summary', async () => {
    const h = await open();
    const id = await startSession(h, '/new localhost:5173');
    await h.fake.client.stopSession(id, {});
    const text = await screenWith(h, /STOPPED/);
    match(text, /STOPPED/);
    match(text, /Context +4.0 KB/);
    match(text, /The session stopped/);
    await quit(h);
  });

  test('home and summary read commands; a pasted URL becomes /new', async () => {
    const h = await open();
    h.type('localhost:3000/login');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /› \/new localhost:3000\/login /);
    h.term.send(ESC);
    h.type('hello');
    h.term.send(ENTER);
    text = await h.term.text();
    match(text, /Commands start with \/\. Try \/new to start a session/);
    h.type('/stop');
    h.term.send(ENTER);
    text = await h.term.text();
    match(text, /\/stop is not available here/);
    await quit(h);
  });

  test('/sessions filters, opens a summary and refuses to rename legacy sessions', async () => {
    const h = await open();
    h.type('/sessions');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /Sessions {2}acme-shop/);
    match(text, /old import/);
    h.type('import');
    h.term.send('\x12');
    text = await h.term.text();
    match(text, /Legacy sessions from terrific-web are read only/);
    for (let i = 0; i < 'import'.length; i += 1) h.term.send('\x7f');
    h.type('checkout');
    h.term.send(ENTER);
    text = await h.term.text();
    match(text, /Session checkout flow/);
    match(text, /Total ignores the coupon/);
    await quit(h);
  });

  test('/ingest closes an endpoint and refuses the one linked to the recording', async () => {
    const h = await open();
    h.type('/ingest');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /Ingest endpoints {2}acme-shop/);
    match(text, /▌ ● app +http:\/\/127\.0\.0\.1:4569\/ingest\/ing_app/);
    h.term.send(' ');
    await h.term.lines();
    deepEqual(calls(h, 'downEndpoint'), [['app']]);
    h.term.send(ESC);
    await startSession(h, '/new localhost:5173 #worker');
    h.type('/ingest');
    h.term.send(ENTER);
    h.term.send(DOWN);
    h.term.send(' ');
    text = await h.term.text();
    match(text, /● session/);
    match(text, /The recording session is linked to worker\. Stop it first/);
    await quit(h);
  });

  test('Ctrl+C twice quits and reports what keeps running', async () => {
    const h = await open();
    await startSession(h, '/new localhost:5173 left running');
    h.term.send(CTRL_C);
    const text = await h.term.text();
    match(text, /Press Ctrl\+C again to quit\. Recording keeps running in the background\./);
    h.term.send(CTRL_C);
    await h.tui.done;
    const message = await detachedMessage(h.fake.client, PROJECT.id, Date.now());
    match(message, /Session s-new-1 "left running" is still recording in the background/);
    match(message, /terrific stop s-new-1 +stop it and print the summary/);
    match(message, /Ingest endpoints still open: app\./);
  });

  test('/profiles sets the default, creates, opens, renames and deletes profiles', async () => {
    const h = await open();
    h.type('/profiles');
    h.term.send(ENTER);
    let text = await h.term.text();
    match(text, /Browser profiles/);
    match(text, /▌ clean .* fresh storage, nothing saved .* default/);
    match(text, /qa-admin +snapshot +Microsoft Edge · saved 2026-03-01 09:00/);
    h.term.send(' ');
    text = await h.term.text();
    match(text, /Clean starts empty every time/);

    h.term.send(DOWN);
    h.term.send(ENTER);
    text = await h.term.text();
    deepEqual(calls(h, 'patchSettings').at(-1), [{ lastSetup: { profile: 'qa-admin' } }]);
    match(text, /\/new now uses @qa-admin/);
    match(text, /qa-admin .* default/);

    h.term.send(CTRL_N);
    h.type('daily');
    h.term.send(DOWN);
    h.term.send(RIGHT);
    text = await h.term.text();
    match(text, /New profile/);
    match(text, /Mode +persistent +· +snapshot .* restores what you save/);
    h.term.send(ENTER);
    text = await h.term.text();
    deepEqual(calls(h, 'createProfile'), [
      [{ name: 'daily', mode: 'snapshot', browser: 'chrome' }],
    ]);
    match(text, /▌ daily +snapshot +Google Chrome · nothing saved yet/);
    match(text, /@daily created\. Space opens it to log in and save/);

    h.term.send(' ');
    text = await h.term.text();
    deepEqual(calls(h, 'openProfile'), [['daily']]);
    match(text, /daily .* ● open/);
    match(text, /Space save/);
    h.term.send(CTRL_R);
    text = await h.term.text();
    match(text, /Close @daily first with Space/);
    h.term.send(' ');
    text = await h.term.text();
    deepEqual(calls(h, 'closeProfile'), [['daily']]);
    match(text, /@daily saved/);

    h.term.send(CTRL_R);
    h.term.send(CTRL_U);
    h.type('nightly');
    h.term.send(ENTER);
    text = await h.term.text();
    deepEqual(calls(h, 'renameProfile'), [['daily', 'nightly']]);
    match(text, /▌ nightly/);

    h.term.send(CTRL_D);
    text = await h.term.text();
    match(text, /Press Ctrl\+D again to delete @nightly/);
    equal(calls(h, 'removeProfile').length, 0);
    h.term.send(CTRL_D);
    text = await h.term.text();
    deepEqual(calls(h, 'removeProfile'), [['nightly']]);
    match(text, /@nightly deleted/);
    h.term.send(ESC);
    text = await h.term.text();
    match(text, /\/new starts from: browser · @qa-admin/);
    await quit(h);
  });

  test('a default profile that is gone falls back to clean', async () => {
    const h = await open(110, 34, async (fake) => {
      await fake.client.patchSettings(PROJECT.id, { lastSetup: { profile: 'treecloud-rod' } });
    });
    const text = await h.term.text();
    match(text, /@treecloud-rod is not available anymore\. \/new now uses @clean/);
    match(text, /\/new starts from: browser · Clean browser \(@clean\)/);
    await quit(h);
  });

  test('a session started elsewhere is picked up without a restart', async () => {
    const h = await open(110, 34, undefined, 50);
    let text = await h.term.text();
    match(text, /no session/);
    const setup = { ...(await h.fake.client.getSettings(PROJECT.id)).lastSetup };
    // Another process, such as `terrific start` in a shell or an agent.
    const view = await h.fake.client.startSession(PROJECT.id, { setup, name: 'from agent' });
    text = await screenWith(h, /from agent is recording\. \/attach to watch it/);
    match(text, /from agent is recording\. \/attach to watch it/);
    match(text, /● REC/);
    match(text, /● from agent {2}s-new-1 {2}\/attach open it/);
    ok(!text.includes('s-checkout'), 'stopped sessions stay off home');
    h.type('/attach');
    h.term.send(ENTER);
    h.fake.emit(view.id, { kind: 'console', level: 'log', text: 'hello from elsewhere' }, 1500);
    text = await screenWith(h, /hello from elsewhere/);
    match(text, /hello from elsewhere/);
    await quit(h);
  });

  test('Enter on a recording session in /sessions opens its live log', async () => {
    // The default refresh is 5 s, so the TUI has not picked the session up by itself yet.
    const h = await open(110, 34);
    const setup = { ...(await h.fake.client.getSettings(PROJECT.id)).lastSetup };
    const view = await h.fake.client.startSession(PROJECT.id, { setup, name: 'agent run' });
    h.type('/sessions agent run');
    h.term.send(ENTER);
    await screenWith(h, /agent run/);
    h.term.send(ENTER);
    h.fake.emit(view.id, { kind: 'console', level: 'log', text: 'live line' }, 1500);
    const text = await screenWith(h, /live line/);
    match(text, /live line/);
    match(text, /● REC/);
    await quit(h);
  });

  test('a resize reflows the screen', async () => {
    const h = await open(110, 34);
    h.term.resize(80, 24);
    const lines = await h.term.lines();
    match(lines[0] ?? '', /^ Terrific {2}acme-shop .*no session $/);
    match(lines[21] ?? '', /\/new starts from/);
    equal((lines[22] ?? '').trim(), '');
    await quit(h);
  });
});
