import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import { connectDaemon, isDaemonUnreachable } from '../client/connect.ts';
import { parseDaemonPort } from '../core/api.ts';
import { dataPaths } from '../core/data-root.ts';
import { isRecord, isString } from '../core/validate.ts';
import type { CliIo } from './io.ts';

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
  fix: string;
};

const ENGINE_RANGE = pkg.engines.node;

export async function runDoctorChecks(io: CliIo, dataRoot: string): Promise<DoctorCheck[]> {
  const { findInstalledBrowsers } = await import('../recorder/browsers.ts');
  const browsers = findInstalledBrowsers({
    platform: io.platform,
    env: io.env,
    exists: existsSync,
  });
  const daemonOk = await probeDaemon(dataRoot, io.env);
  const port = parseDaemonPort(io.env.TERRIFIC_PORT);

  return [
    nodeCheck(),
    browserCheck(browsers.length > 0),
    await dataRootCheck(dataRoot),
    daemonCheck(daemonOk),
    await portCheck(port, daemonOk),
    await legacyCheck(dataRoot),
  ];
}

function check(name: string, ok: boolean, detail: string, fix = ''): DoctorCheck {
  return { name, ok, detail, fix: ok ? '' : fix };
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function meetsEngine(version: string, engine: string): boolean {
  const floor = parseSemver(engine.replace(/^>=/, ''));
  const parsed = parseSemver(version);
  if (floor === null || parsed === null) return false;
  if (parsed.major !== floor.major) return parsed.major > floor.major;
  if (parsed.minor !== floor.minor) return parsed.minor > floor.minor;
  return parsed.patch >= floor.patch;
}

function nodeCheck(): DoctorCheck {
  const version = process.version;
  const ok = meetsEngine(version, ENGINE_RANGE);
  return check(
    'node',
    ok,
    ok
      ? `${version} meets ${ENGINE_RANGE}`
      : `${version} is below the required Node ${ENGINE_RANGE}`,
    `Install Node.js ${ENGINE_RANGE.replace(/^>=/, '')} or newer.`,
  );
}

function browserCheck(found: boolean): DoctorCheck {
  return check(
    'browser',
    found,
    found ? 'at least one Chromium-based browser is installed' : 'no Chromium-based browser found',
    'Install Chrome or Edge.',
  );
}

async function dataRootCheck(dataRoot: string): Promise<DoctorCheck> {
  const probe = join(dataRoot, '.terrific-doctor-probe');
  try {
    await mkdir(dataRoot, { recursive: true });
    await writeFile(probe, 'ok', 'utf8');
    await unlink(probe);
    return check('data-root', true, `writable ${dataRoot}`);
  } catch {
    return check(
      'data-root',
      false,
      `cannot write ${dataRoot}`,
      'Create a writable data directory or set TERRIFIC_HOME.',
    );
  }
}

async function probeDaemon(
  dataRoot: string,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  try {
    await connectDaemon({ dataRoot, env, autoStart: false });
    return true;
  } catch (error) {
    if (isDaemonUnreachable(error)) return false;
    throw error;
  }
}

function daemonCheck(ok: boolean): DoctorCheck {
  return check(
    'daemon',
    ok,
    ok ? 'reachable with the stored token' : 'daemon is not reachable',
    'terrific daemon start',
  );
}

async function portHeld(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(true);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(false);
      });
    });
  });
}

async function portCheck(port: number, daemonOk: boolean): Promise<DoctorCheck> {
  if (daemonOk) {
    return check('port', true, `${port} is held by the terrific daemon`);
  }
  const busy = await portHeld(port);
  if (!busy) return check('port', true, `${port} is free`);
  return check(
    'port',
    false,
    `${port} is in use by another process`,
    'Stop the process using that port, or set TERRIFIC_PORT.',
  );
}

async function isDir(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

async function countSessionDirs(sessionsDir: string): Promise<number> {
  try {
    const names = await readdir(sessionsDir, { withFileTypes: true });
    return names.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function countWorkspaceStores(dataRoot: string): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(dataPaths(dataRoot).legacyWorkspacesFile, 'utf8'));
  } catch {
    return 0;
  }
  if (!isRecord(parsed) || !isRecord(parsed.workspaces)) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const item of Object.values(parsed.workspaces)) {
    if (!isRecord(item) || !isString(item.path)) continue;
    const sessionsDir = join(item.path, 'sessions');
    const key = sessionsDir.toLowerCase();
    if (seen.has(key) || !(await isDir(sessionsDir))) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

async function legacyCheck(dataRoot: string): Promise<DoctorCheck> {
  const paths = dataPaths(dataRoot);
  const globalSessions = (await isDir(paths.legacySessionsDir))
    ? await countSessionDirs(paths.legacySessionsDir)
    : 0;
  const workspaceStores = await countWorkspaceStores(dataRoot);
  return check(
    'legacy',
    true,
    `${globalSessions} global sessions, ${workspaceStores} workspace stores`,
  );
}
