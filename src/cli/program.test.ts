import { match, ok } from 'node:assert/strict';
import { getRandomValues } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { type DaemonHandle, startDaemon } from '../daemon/daemon.ts';
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
