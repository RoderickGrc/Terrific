import { appendFile, chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import { DEFAULT_DAEMON_PORT } from '../core/api.ts';
import { isTerrificError, TerrificError } from '../core/errors.ts';
import { type RandomSource, randomId } from '../core/ids.ts';
import type { LaunchOptions } from '../recorder/launch.ts';
import { dataPaths } from '../store/data-root.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { createProjectStore } from '../store/projects.ts';
import { createRouter, mapError, type Router, sendJson } from './http.ts';
import { createIngestService, type IngestHooks, type IngestService } from './ingest-service.ts';
import { defaultResolveBrowser } from './resolve-browser.ts';
import { registerCoreRoutes } from './routes-core.ts';
import { registerIngestRoutes } from './routes-ingest.ts';
import { registerReadingRoutes } from './routes-reading.ts';
import { registerSessionRoutes } from './routes-sessions.ts';
import { createSessionCatalog } from './session-catalog.ts';
import { createSessionService, type SessionService } from './session-service.ts';
import { createStreamHub, type StreamHub } from './stream-hub.ts';

export { DEFAULT_DAEMON_PORT };

export type DaemonLog = {
  info(message: string): void;
  error(message: string, err?: unknown): void;
};

export type DaemonServices = {
  hooks: IngestHooks;
  ingest: IngestService;
  sessions: SessionService;
  projects: ReturnType<typeof createProjectStore>;
  hub: StreamHub;
  router: Router;
};

export type DaemonHandle = {
  port: number;
  token: string;
  url: string;
  runMaintenance(): Promise<void>;
  close(options?: { stopSessions?: boolean }): Promise<void>;
  services: DaemonServices;
};

export type StartDaemonOptions = {
  dataRoot: string;
  port: number;
  appVersion: string;
  now: () => Date;
  random: RandomSource;
  maintenanceIntervalMs?: number;
  resolveBrowser?: (profile: string) => LaunchOptions;
};

type DaemonFile = {
  version: 1;
  pid: number;
  port: number;
  startedAt: string;
  appVersion: string;
};

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function listenError(error: unknown, port: number): TerrificError {
  if (isErrno(error, 'EADDRINUSE')) {
    return new TerrificError(
      'CONFLICT',
      `Port ${port} is in use. Is another terrific-cli daemon running? ` +
        'Set TERRIFIC_PORT to use another port.',
    );
  }
  const message = error instanceof Error ? error.message : 'Failed to listen.';
  return new TerrificError('INTERNAL', message);
}

export function parseDaemonPort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_DAEMON_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TerrificError('USAGE', 'TERRIFIC_PORT must be an integer between 0 and 65535.');
  }
  return port;
}

export function createDaemonLog(logPath: string, now: () => Date): DaemonLog {
  async function write(level: string, message: string): Promise<void> {
    const line = `${now().toISOString()} ${level} ${message}\n`;
    try {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, line, 'utf8');
    } catch {
      // A log failure must not take the daemon down.
    }
  }
  return {
    info(message) {
      void write('info', message);
    },
    error(message, err) {
      const stack = err instanceof Error && err.stack !== undefined ? `\n${err.stack}` : '';
      void write('error', `${message}${stack}`);
    },
  };
}

export async function loadOrCreateToken(tokenFile: string, random: RandomSource): Promise<string> {
  try {
    const existing = (await readFile(tokenFile, 'utf8')).trim();
    if (existing !== '') return existing;
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
  const token = randomId(32, random);
  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(tokenFile, 0o600);
  } catch {
    // Windows ignores POSIX file modes.
  }
  return token;
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(listenError(error, port));
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TerrificError('INTERNAL', 'Daemon socket did not bind a TCP port.');
  }
  return address.port;
}

export async function startDaemon(options: StartDaemonOptions): Promise<DaemonHandle> {
  const paths = dataPaths(options.dataRoot);
  await mkdir(options.dataRoot, { recursive: true });
  const token = await loadOrCreateToken(paths.tokenFile, options.random);
  const startedAt = options.now().toISOString();
  const runtime = { port: options.port };
  const log = createDaemonLog(paths.daemonLog, options.now);
  const hooks: IngestHooks = {
    isLinked: () => false,
    onIngest: () => undefined,
  };
  const projects = createProjectStore({
    root: options.dataRoot,
    now: options.now,
    random: options.random,
  });
  const hub = createStreamHub();
  const ingest = await createIngestService({
    projects,
    hub,
    now: options.now,
    random: options.random,
    getPort: () => runtime.port,
    hooks,
  });
  const sessions = createSessionService({
    projects,
    ingest,
    hub,
    now: options.now,
    random: options.random,
    resolveBrowser: options.resolveBrowser ?? defaultResolveBrowser,
  });
  hooks.isLinked = (projectId, name) => sessions.isLinked(projectId, name);
  hooks.onIngest = (projectId, name, event) => sessions.onIngest(projectId, name, event);
  const router = createRouter({
    token,
    getPort: () => runtime.port,
    log,
  });
  registerCoreRoutes(router, {
    projects,
    appVersion: options.appVersion,
    pid: process.pid,
    getPort: () => runtime.port,
    startedAt,
  });
  registerIngestRoutes(router, { ingest, hub });
  registerSessionRoutes(router, {
    sessions,
    ingest,
    projects,
    hub,
    appVersion: options.appVersion,
    pid: process.pid,
    getPort: () => runtime.port,
    startedAt,
  });
  const catalog = createSessionCatalog({
    dataRoot: options.dataRoot,
    projects,
    sessions,
    now: options.now,
    random: options.random,
  });
  registerReadingRoutes(router, {
    catalog,
    sessions,
    ingest,
    projects,
    now: options.now,
  });
  await sessions.recoverInterrupted();
  const server = createServer((req, res) => {
    void router.handle(req, res).catch((error: unknown) => {
      if (!isTerrificError(error)) {
        log.error(error instanceof Error ? error.message : 'request failed', error);
      }
      if (!res.headersSent) {
        const mapped = mapError(error);
        sendJson(res, mapped.status, mapped.body);
      } else {
        res.destroy();
      }
    });
  });
  try {
    runtime.port = await listen(server, options.port);
  } catch (error) {
    server.close();
    throw error;
  }
  const file: DaemonFile = {
    version: 1,
    pid: process.pid,
    port: runtime.port,
    startedAt,
    appVersion: options.appVersion,
  };
  await writeJsonFile(paths.daemonFile, file);
  log.info(`listening on 127.0.0.1:${runtime.port}`);
  const intervalMs = options.maintenanceIntervalMs ?? 60_000;
  const timer = setInterval(() => {
    void ingest.closeIdle().catch((error: unknown) => {
      log.error('maintenance failed', error);
    });
  }, intervalMs);
  timer.unref();
  const services: DaemonServices = { hooks, ingest, sessions, projects, hub, router };
  return {
    port: runtime.port,
    token,
    url: `http://127.0.0.1:${runtime.port}`,
    services,
    async runMaintenance() {
      await ingest.closeIdle();
    },
    async close(closeOptions) {
      clearInterval(timer);
      if (closeOptions?.stopSessions !== false) await sessions.stopAll();
      router.closeConnections();
      hub.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      try {
        await unlink(paths.daemonFile);
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error;
      }
    },
  };
}
