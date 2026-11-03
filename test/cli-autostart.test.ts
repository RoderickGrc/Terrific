import { match, ok } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dataPaths } from '../src/core/data-root.ts';
import { freePort } from './helpers/free-port.ts';

const dirs: string[] = [];
const daemons: Record<string, string>[] = [];
const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));

// The daemon is detached on purpose, so a test that fails midway would leave it running.
after(async () => {
  await Promise.all(daemons.map((env) => run(['daemon', 'stop'], env)));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-autostart-'));
  dirs.push(dir);
  return dir;
}

function run(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('daemon start spawns a detached daemon that status and stop can reach', async () => {
  const home = await tempHome();
  const port = await freePort();
  const env = { TERRIFIC_HOME: home, TERRIFIC_PORT: String(port) };
  daemons.push(env);
  const started = await run(['daemon', 'start'], env);
  match(started.out, new RegExp(`daemon running on 127\\.0\\.0\\.1:${port}`));
  match(started.out, /started/);
  ok(started.code === 0, started.err);

  const status = await run(['daemon', 'status'], env);
  match(status.out, new RegExp(`daemon running on 127\\.0\\.0\\.1:${port}`));
  ok(status.code === 0, status.err);

  const stopped = await run(['daemon', 'stop'], env);
  ok(stopped.code === 0, stopped.err);
  ok(!(await exists(dataPaths(home).daemonFile)), 'daemon.json should be removed after stop');
});

/** Answers like a daemon from before API_VERSION 2: health has no apiVersion. */
async function oldDaemon(home: string, port: number, recording: number) {
  await writeFile(dataPaths(home).tokenFile, 'old-token');
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/health') {
      res.end(JSON.stringify({ appVersion: '0.0.0', pid: 1, port, startedAt: '' }));
    } else if (req.url === '/v1/status') {
      const sessions = Array.from({ length: recording }, (_, i) => ({ id: `s${i}` }));
      res.end(JSON.stringify({ daemon: {}, sessions, endpoints: [] }));
    } else if (req.url === '/v1/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }), () => {
        server.close();
        server.closeAllConnections();
      });
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a daemon left from an older build is replaced when it records nothing', async () => {
  const home = await tempHome();
  const port = await freePort();
  const env = { TERRIFIC_HOME: home, TERRIFIC_PORT: String(port), TERRIFIC_HEADLESS: '1' };
  const old = await oldDaemon(home, port, 0);
  daemons.push(env);
  const listed = await run(['profiles', '--json'], env);
  ok(listed.code === 0, listed.err);
  ok(old.requests.includes('POST /v1/daemon/shutdown'), old.requests.join(', '));
  const profiles = JSON.parse(listed.out) as { slug: string; kind: string }[];
  ok(profiles.every((profile) => typeof profile.kind === 'string'));
});

test('a daemon left from an older build that is recording is kept, with a way out', async () => {
  const home = await tempHome();
  const port = await freePort();
  const env = { TERRIFIC_HOME: home, TERRIFIC_PORT: String(port) };
  const old = await oldDaemon(home, port, 1);
  try {
    const listed = await run(['profiles'], env);
    ok(listed.code !== 0);
    match(
      listed.err,
      /older terrific and is recording 1 session\. Stop it, then run terrific daemon stop/,
    );
    ok(!old.requests.includes('POST /v1/daemon/shutdown'));
  } finally {
    await old.close();
  }
});
