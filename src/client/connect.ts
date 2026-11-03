import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseDaemonPort } from '../core/api.ts';
import { dataPaths } from '../core/data-root.ts';
import { TerrificError } from '../core/errors.ts';
import { isRecord } from '../core/validate.ts';
import { createDaemonClient, type DaemonClient } from './daemon-client.ts';

export type ConnectDaemonOptions = {
  dataRoot: string;
  env: Record<string, string | undefined>;
  autoStart: boolean;
};

export type ConnectedDaemon = {
  client: DaemonClient;
  port: number;
  token: string;
  started: boolean;
};

const UNREACHABLE = 'Cannot reach the terrific-cli daemon.';
const POLL_MS = 100;
const POLL_LIMIT_MS = 10_000;

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function isDaemonUnreachable(error: unknown): boolean {
  return (
    error instanceof TerrificError && error.code === 'INTERNAL' && error.message === UNREACHABLE
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readToken(tokenFile: string): Promise<string | undefined> {
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    return token === '' ? undefined : token;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function readDaemonPid(daemonFile: string): Promise<number | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(daemonFile, 'utf8'));
    if (!isRecord(parsed) || typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) {
      return undefined;
    }
    return parsed.pid;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function probe(port: number, token: string): Promise<DaemonClient | undefined> {
  const client = createDaemonClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token,
  });
  try {
    await client.health();
    return client;
  } catch {
    return undefined;
  }
}

function spawnDaemon(
  env: Record<string, string | undefined>,
  dataRoot: string,
  port: number,
): void {
  const script = process.argv[1];
  if (script === undefined || script === '') {
    throw new TerrificError('INTERNAL', UNREACHABLE);
  }
  const child = spawn(process.execPath, [...process.execArgv, script, 'daemon', 'run'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ...env,
      TERRIFIC_HOME: dataRoot,
      TERRIFIC_PORT: String(port),
    },
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function connectDaemon(options: ConnectDaemonOptions): Promise<ConnectedDaemon> {
  const port = parseDaemonPort(options.env.TERRIFIC_PORT);
  const paths = dataPaths(options.dataRoot);

  const tryConnect = async (): Promise<Omit<ConnectedDaemon, 'started'> | undefined> => {
    const token = await readToken(paths.tokenFile);
    if (token === undefined) return undefined;
    const client = await probe(port, token);
    if (client === undefined) return undefined;
    return { client, port, token };
  };

  const existing = await tryConnect();
  if (existing !== undefined) return { ...existing, started: false };

  if (!options.autoStart) throw new TerrificError('INTERNAL', UNREACHABLE);

  const pid = await readDaemonPid(paths.daemonFile);
  // A leftover daemon.json with a dead pid must not look like a start in progress.
  const alreadySpawning = pid !== undefined && isPidAlive(pid);
  if (!alreadySpawning) spawnDaemon(options.env, options.dataRoot, port);

  const deadline = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < deadline) {
    const next = await tryConnect();
    if (next !== undefined) return { ...next, started: !alreadySpawning };
    await sleep(POLL_MS);
  }
  throw new TerrificError('INTERNAL', UNREACHABLE);
}
