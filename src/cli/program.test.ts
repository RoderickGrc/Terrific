import { deepEqual, match, ok } from 'node:assert/strict';
import { getRandomValues } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { SessionView } from '../core/api.ts';
import { type DaemonHandle, startDaemon } from '../daemon/daemon.ts';
import { resolveBrowserProfile } from '../daemon/resolve-browser.ts';
import { findInstalledBrowsers } from '../recorder/browsers.ts';
import type { CliIo } from './io.ts';
import { runCli } from './program.ts';

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

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function captureIo(
  cwd: string,
  env: Record<string, string | undefined>,
): CliIo & {
  out: string;
  err: string;
} {
  let out = '';
  let err = '';
  return {
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    stdout(text) {
      out += text;
    },
    stderr(text) {
      err += text;
    },
    cwd,
    env,
    platform: process.platform,
    homedir: tmpdir(),
  };
}

async function setup() {
  const dataRoot = await tempDir('terrific-cli-home-');
  const cwd = await tempDir('terrific-cli-cwd-');
  const handle = await startDaemon({
    dataRoot,
    port: 0,
    appVersion: '0.0.0-test',
    now: () => new Date(),
    random: (n) => getRandomValues(new Uint8Array(n)),
    resolveBrowser: (profile) => resolveBrowserProfile(profile, true),
  });
  handles.push(handle);
  const env = {
    TERRIFIC_HOME: dataRoot,
    TERRIFIC_PORT: String(handle.port),
  };
  return { cwd, env, handle };
}

function argv(...args: string[]): string[] {
  return ['node', 'terrific-cli', ...args];
}

test('ingest up is idempotent and --json includes url', async () => {
  const { cwd, env } = await setup();
  const first = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app'), first), 0);
  const second = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app'), second), 0);
  match(first.out, /^app\s+http:\/\/127\.0\.0\.1:\d+\/ingest\/ing_/);
  equalText(first.out, second.out);

  const jsonIo = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app', '--json'), jsonIo), 0);
  const parsed = JSON.parse(jsonIo.out) as { url?: string; name?: string };
  match(parsed.url ?? '', /^http:\/\/127\.0\.0\.1:\d+\/ingest\//);
  equalText(parsed.name, 'app');
});

test('ingest list, down then up keeps the URL, rename, and rm', async () => {
  const { cwd, env } = await setup();
  const up = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app'), up), 0);
  const url = up.out.trim().split(/\s+/)[1];

  const list = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'list'), list), 0);
  match(list.out, /app/);
  match(list.out, /open/);

  equalExit(await runCli(argv('ingest', 'down', 'app'), captureIo(cwd, env)), 0);
  const again = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app'), again), 0);
  equalText(again.out.trim().split(/\s+/)[1], url);

  const renamed = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'rename', 'app', 'api'), renamed), 0);
  match(renamed.out, /api/);

  const removed = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'rm', 'api'), removed), 0);
  match(removed.out, /deleted/);
});

test('status --json has daemon and projects lists the temp cwd', async () => {
  const { cwd, env } = await setup();
  equalExit(await runCli(argv('ingest', 'up', 'app'), captureIo(cwd, env)), 0);

  const status = captureIo(cwd, env);
  equalExit(await runCli(argv('status', '--json'), status), 0);
  const body = JSON.parse(status.out) as { daemon?: { port?: number } };
  const daemon = body.daemon;
  ok(daemon !== undefined && typeof daemon.port === 'number');

  const projects = captureIo(cwd, env);
  equalExit(await runCli(argv('projects'), projects), 0);
  match(projects.out, new RegExp(cwd.replace(/\\/g, '\\\\')));
});

test('unknown command exits 2 and ingest rm missing exits 1 with error:', async () => {
  const { cwd, env } = await setup();
  const unknown = captureIo(cwd, env);
  equalExit(await runCli(argv('nope'), unknown), 2);

  const missing = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'rm', 'missing'), missing), 1);
  match(missing.err, /^error:/);
});

function sessionId(out: string): string {
  const matchId = /^session\s+(\S+)\s+recording/m.exec(out);
  if (matchId?.[1] === undefined) throw new Error(`no session id in ${JSON.stringify(out)}`);
  return matchId[1];
}

function ingestUrl(out: string): string {
  const matchUrl = /^ingest\s+(\S+)/m.exec(out);
  if (matchUrl?.[1] === undefined) throw new Error(`no ingest url in ${JSON.stringify(out)}`);
  return matchUrl[1];
}

async function serveHtml(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server did not bind a port');
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test('agent flow: no-browser session, marks, ingest, events, stop, show, prompt', async () => {
  const { cwd, env } = await setup();
  const up = captureIo(cwd, env);
  equalExit(await runCli(argv('ingest', 'up', 'app'), up), 0);

  const started = captureIo(cwd, env);
  equalExit(await runCli(argv('start', 'fullstack check', '#app'), started), 0);
  match(started.out, /^session \S+ recording/m);
  match(started.out, /^folder /m);
  match(started.out, /^ingest http:\/\/127\.0\.0\.1:\d+\/ingest\//m);
  const id = sessionId(started.out);
  const posted = await fetch(ingestUrl(started.out), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'from-app', source: 'test' }),
  });
  if (posted.status !== 202) throw new Error(`ingest POST ${posted.status}`);
  const deadline = Date.now() + 4000;
  let sawIngest = false;
  while (Date.now() < deadline) {
    const probe = captureIo(cwd, env);
    equalExit(await runCli(argv('events', id, '--type', 'ingest', '--json'), probe), 0);
    const rows = JSON.parse(probe.out) as { message?: string }[];
    if (rows.some((row) => row.message === 'from-app')) {
      sawIngest = true;
      break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  if (!sawIngest) throw new Error('ingest event was not copied into the session');

  const note = captureIo(cwd, env);
  equalExit(await runCli(argv('note', id, 'looks', 'fine'), note), 0);
  match(note.out, /^note at /);

  const bug = captureIo(cwd, env);
  equalExit(await runCli(argv('bug', id), bug), 0);
  match(bug.out, /^bug at /);

  const typed = captureIo(cwd, env);
  equalExit(await runCli(argv('events', id, '--type', 'bug,note'), typed), 0);
  match(typed.out, /looks fine/);
  match(typed.out, /Bug reported/);

  const ingestJson = captureIo(cwd, env);
  equalExit(await runCli(argv('events', id, '--type', 'ingest', '--json'), ingestJson), 0);
  const ingestEvents = JSON.parse(ingestJson.out) as { kind?: string; message?: string }[];
  ok(Array.isArray(ingestEvents));
  ok(ingestEvents.some((event) => event.kind === 'ingest' && event.message === 'from-app'));

  const stopped = captureIo(cwd, env);
  equalExit(await runCli(argv('stop', '--name', 'renamed'), stopped), 0);
  match(stopped.out, /1 bug to review/);
  match(stopped.out, /Same setup {2}\/new renamed #app --no-browser/);

  const shown = captureIo(cwd, env);
  equalExit(await runCli(argv('show', id, '--json'), shown), 0);
  const detail = JSON.parse(shown.out) as { id?: string; name?: string; verdict?: string };
  equalText(detail.id, id);
  equalText(detail.name, 'renamed');

  const prompt = captureIo(cwd, env);
  equalExit(await runCli(argv('prompt', id), prompt), 0);
  match(prompt.out, /context\.txt/);
  // Marks made through the CLI come from an agent and the prompt says so.
  match(prompt.out, /bug at \d\d:\d\d\.\d \(marked by an agent\)/);
  match(prompt.out, /\n$/);

  const context = captureIo(cwd, env);
  equalExit(await runCli(argv('context', id, '--only', 'bug'), context), 0);
  match(context.out, /context\.txt/);
  match(context.out, /~/);
});

test('profiles --json includes clean when a browser is installed', async (t) => {
  const installed = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
  if (installed[0] === undefined) {
    t.skip('no Chromium-based browser installed');
    return;
  }
  const { cwd, env } = await setup();
  const jsonIo = captureIo(cwd, env);
  equalExit(await runCli(argv('profiles', '--json'), jsonIo), 0);
  const listed = JSON.parse(jsonIo.out) as { slug?: string; label?: string }[];
  ok(Array.isArray(listed) && listed.length > 0);
  equalText(listed[0]?.slug, 'clean');
  equalText(listed[0]?.label, 'Clean browser');
});

test('doctor --json has the check shape and a writable temp data root', async () => {
  const { cwd, env } = await setup();
  const jsonIo = captureIo(cwd, env);
  const code = await runCli(argv('doctor', '--json'), jsonIo);
  const body = JSON.parse(jsonIo.out) as {
    checks?: { name?: string; ok?: boolean; detail?: string; fix?: string }[];
  };
  ok(Array.isArray(body.checks));
  const names = (body.checks ?? []).map((item) => item.name);
  deepEqual(names, ['node', 'browser', 'data-root', 'daemon', 'port', 'legacy', 'profiles']);
  const dataRoot = (body.checks ?? []).find((item) => item.name === 'data-root');
  ok(dataRoot?.ok === true);
  if (code !== 0 && code !== 1) {
    throw new Error(`expected doctor exit 0 or 1, got ${code}`);
  }
});

test('start @nope exits 2 listing the problem and stop with none exits 2', async () => {
  const { cwd, env } = await setup();
  const nope = captureIo(cwd, env);
  equalExit(await runCli(argv('start', '@nope'), nope), 2);
  match(nope.err, /@nope {2}no profile called "nope"/);

  const none = captureIo(cwd, env);
  equalExit(await runCli(argv('stop'), none), 2);
  match(none.err, /No running session/);
});

test('start hands /new flags through and still honors --json', async (t) => {
  const installed = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
  if (installed[0] === undefined) {
    t.skip('no Chromium-based browser installed');
    return;
  }
  const { cwd, env } = await setup();
  equalExit(await runCli(argv('ingest', 'up', 'app'), captureIo(cwd, env)), 0);
  const site = await serveHtml('<html><body><p>ok</p></body></html>');
  try {
    const started = captureIo(cwd, env);
    const host = site.url.replace(/^https?:\/\//, '');
    equalExit(
      await runCli(argv('start', host, 'x y', '@clean', '#app', '--no-console', '--json'), started),
      0,
    );
    const session = JSON.parse(started.out) as SessionView;
    equalText(session.name ?? undefined, 'x y');
    equalText(session.setup.profile, 'clean');
    if (session.setup.record.console !== false) {
      throw new Error('expected --no-console to reach parseNewArgv');
    }
    if (session.endpoint === null) throw new Error('expected #app to link an endpoint');
    equalExit(await runCli(argv('stop', session.id), captureIo(cwd, env)), 0);
  } finally {
    await site.close();
  }
});

test('events --follow prints a later note and ends when the session stops', {
  timeout: 15_000,
}, async () => {
  const { cwd, env } = await setup();
  equalExit(await runCli(argv('ingest', 'up', 'app'), captureIo(cwd, env)), 0);
  const started = captureIo(cwd, env);
  equalExit(await runCli(argv('start', 'follow check', '#app'), started), 0);
  const id = sessionId(started.out);

  const followIo = captureIo(cwd, env);
  const follow = runCli(argv('events', id, '--follow'), followIo);
  await new Promise((resolve) => {
    setTimeout(resolve, 400);
  });
  equalExit(await runCli(argv('note', id, 'later note'), captureIo(cwd, env)), 0);
  equalExit(await runCli(argv('stop', id), captureIo(cwd, env)), 0);
  equalExit(await follow, 0);
  match(followIo.out, /later note/);
});

test('browser session: start --no-console, screenshot, snapshot, stop', {
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
  const { cwd, env } = await setup();
  const site = await serveHtml('<html><body><button>Go</button></body></html>');
  try {
    const started = captureIo(cwd, env);
    const host = site.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    equalExit(await runCli(argv('start', host, '--no-console'), started), 0);
    const id = sessionId(started.out);

    const shot = captureIo(cwd, env);
    equalExit(await runCli(argv('screenshot', id), shot), 0);
    match(shot.out, /\.png/);

    const snap = captureIo(cwd, env);
    equalExit(await runCli(argv('snapshot', id), snap), 0);
    match(snap.out, /words/);

    const stopped = captureIo(cwd, env);
    equalExit(await runCli(argv('stop', id), stopped), 0);
    match(stopped.out, /Same setup/);
  } finally {
    await site.close();
  }
});

function equalExit(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`expected exit ${expected}, got ${actual}`);
  }
}

function equalText(actual: string | undefined, expected: string | undefined): void {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
