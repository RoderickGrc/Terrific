import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInstalledBrowsers } from '../src/recorder/browsers.ts';
import { freePort } from '../test/helpers/free-port.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'dist', 'bin.js');

class SmokeFailure extends Error {}

// Throwing (instead of exiting) lets main's finally stop the daemon and remove the temp root.
function fail(step: string, detail: string): never {
  throw new SmokeFailure(`smoke failed: ${step}: ${detail}`);
}

async function servePage(): Promise<{ url: string; close: () => Promise<void> }> {
  // The page clicks its own button once loaded, so the smoke proves the bundled in-page
  // script was serialized correctly and reports actions.
  const html =
    '<!doctype html><html><body><button id="go">Go</button>' +
    "<script>addEventListener('load', () => setTimeout(() => document.getElementById('go').click(), 300));</script>" +
    '</body></html>';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') fail('serve', 'no port');
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

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeout = 20_000,
): { status: number; out: string; err: string } {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    out: result.stdout,
    err: result.stderr + (result.error === undefined ? '' : result.error.message),
  };
}

function expectOk(step: string, result: { status: number; out: string; err: string }): string {
  if (result.status !== 0) fail(step, result.err || result.out || `exit ${result.status}`);
  return result.out;
}

function sessionId(out: string): string {
  const match = /^session\s+(\S+)\s+recording/m.exec(out);
  if (match?.[1] === undefined) fail('start', `no session id in ${out}`);
  return match[1];
}

function ingestUrl(out: string): string {
  const match = /^ingest\s+(\S+)/m.exec(out);
  if (match?.[1] === undefined) fail('start', `no ingest url in ${out}`);
  return match[1];
}

async function waitIngest(id: string, env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = run(['events', id, '--type', 'ingest', '--json'], env, cwd);
    if (result.status === 0) {
      const rows = JSON.parse(result.out) as { message?: string }[];
      if (rows.some((row) => row.message === 'from-app')) return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  fail('events ingest', 'ingest event never arrived');
}

async function main(): Promise<void> {
  if (!existsSync(bin)) fail('build', `missing ${bin}`);
  const home = await mkdtemp(join(tmpdir(), 'terrific-smoke-home-'));
  const cwd = await mkdtemp(join(tmpdir(), 'terrific-smoke-cwd-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERRIFIC_HOME: home,
    TERRIFIC_PORT: String(await freePort()),
    TERRIFIC_HEADLESS: '1',
  };
  try {
    expectOk('ingest up', run(['ingest', 'up', 'app'], env, cwd));
    const started = expectOk('start', run(['start', 'fullstack check', '#app'], env, cwd));
    const id = sessionId(started);
    const posted = await fetch(ingestUrl(started), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'from-app', source: 'smoke' }),
    });
    if (posted.status !== 202) fail('ingest POST', `status ${posted.status}`);
    expectOk('note', run(['note', id, 'looks fine'], env, cwd));
    expectOk('bug', run(['bug', id], env, cwd));
    await waitIngest(id, env, cwd);
    const ingestJson = expectOk(
      'events json',
      run(['events', id, '--type', 'ingest', '--json'], env, cwd),
    );
    JSON.parse(ingestJson);
    expectOk('stop', run(['stop', '--name', 'renamed'], env, cwd));
    JSON.parse(expectOk('show json', run(['show', id, '--json'], env, cwd)));
    const prompt = expectOk('prompt', run(['prompt', id], env, cwd));
    if (!prompt.includes('context.txt')) fail('prompt', 'missing context path');

    const browsers = findInstalledBrowsers({
      platform: process.platform,
      env: process.env,
      exists: existsSync,
    });
    if (browsers[0] !== undefined) {
      const site = await servePage();
      try {
        const host = site.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const browserStart = expectOk(
          'browser start',
          run(['start', host, '--no-console'], env, cwd, 60_000),
        );
        const bid = sessionId(browserStart);
        const pollEvents = async (
          id: string,
          type: string,
          match: (event: { url?: string; action?: string }) => boolean,
        ): Promise<boolean> => {
          const deadline = Date.now() + 15_000;
          while (Date.now() < deadline) {
            const result = run(['events', id, '--type', type, '--json'], env, cwd);
            if (result.status === 0) {
              const events = JSON.parse(result.out) as { url?: string; action?: string }[];
              if (events.some(match)) return true;
            }
            await new Promise((resolve) => {
              setTimeout(resolve, 100);
            });
          }
          return false;
        };
        // A Chrome error page also produces a navigation, so require the served URL itself.
        const navigated = await pollEvents(bid, 'navigation', (event) =>
          (event.url ?? '').startsWith(site.url),
        );
        if (!navigated) fail('navigation events', `no navigation to ${site.url}`);
        const clicked = await pollEvents(bid, 'action', (event) => event.action === 'click');
        if (!clicked) fail('action events', 'the in-page script reported no click');
        expectOk('snapshot', run(['snapshot', bid], env, cwd, 30_000));
        expectOk('browser stop', run(['stop', bid], env, cwd, 30_000));
      } finally {
        await site.close();
      }
    }
  } finally {
    run(['daemon', 'stop'], env, cwd);
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
  console.log('smoke ok');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof SmokeFailure ? error.message : error);
  process.exitCode = 1;
}
