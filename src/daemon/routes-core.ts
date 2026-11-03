import { isAbsolute } from 'node:path';
import { API_VERSION, type HealthView, type ProjectView } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { isRecord, isString } from '../core/validate.ts';
import type { createProjectStore } from '../store/projects.ts';
import type { Router } from './http.ts';

type ProjectStore = ReturnType<typeof createProjectStore>;

export type CoreRouteDeps = {
  projects: ProjectStore;
  appVersion: string;
  pid: number;
  getPort: () => number;
  startedAt: string;
  requestShutdown: () => void;
};

function toProjectView(project: {
  id: string;
  cwd: string;
  createdAt: string;
  lastOpenedAt: string;
}): ProjectView {
  return {
    id: project.id,
    cwd: project.cwd,
    createdAt: project.createdAt,
    lastOpenedAt: project.lastOpenedAt,
  };
}

function readAbsoluteCwd(body: unknown): string {
  if (!isRecord(body) || !isString(body.cwd) || !isAbsolute(body.cwd)) {
    throw new TerrificError('USAGE', 'cwd must be an absolute path.');
  }
  return body.cwd;
}

export function registerCoreRoutes(router: Router, deps: CoreRouteDeps): void {
  router.route('GET', '/v1/health', (ctx) => {
    const body: HealthView = {
      appVersion: deps.appVersion,
      apiVersion: API_VERSION,
      pid: deps.pid,
      port: deps.getPort(),
      startedAt: deps.startedAt,
    };
    ctx.send(200, body);
  });

  router.route(
    'POST',
    '/v1/projects/resolve',
    async (ctx) => {
      const project = await deps.projects.resolve(readAbsoluteCwd(ctx.body));
      ctx.send(200, toProjectView(project));
    },
    { body: 'json' },
  );

  router.route('GET', '/v1/projects', async (ctx) => {
    const projects = await deps.projects.list();
    ctx.send(200, projects.map(toProjectView));
  });

  router.route('POST', '/v1/daemon/shutdown', (ctx) => {
    ctx.res.once('finish', () => {
      deps.requestShutdown();
    });
    ctx.send(200, { ok: true });
  });
}
