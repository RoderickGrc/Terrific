import { match, ok } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
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
