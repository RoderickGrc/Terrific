import { DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { isRecord, isString } from '../core/validate.ts';
import { type RouteContext, type Router, routeParam } from './http.ts';
import type { IngestService } from './ingest-service.ts';
import { endpointTopic, type StreamHub } from './stream-hub.ts';

export type IngestRouteDeps = {
  ingest: IngestService;
  hub: StreamHub;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

function readName(body: unknown): string {
  if (!isRecord(body) || !isString(body.name)) {
    throw new TerrificError('USAGE', 'name is required.');
  }
  return body.name;
}

function readLimit(query: URLSearchParams): number {
  const raw = query.get('limit');
  if (raw === null || raw === '') return DEFAULT_EVENT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_EVENT_LIMIT;
  return Math.min(value, MAX_EVENT_LIMIT);
}

function ids(ctx: RouteContext): { projectId: string; name: string } {
  return {
    projectId: routeParam(ctx.params, 'projectId'),
    name: routeParam(ctx.params, 'name'),
  };
}

export function registerIngestRoutes(router: Router, deps: IngestRouteDeps): void {
  router.route('GET', '/v1/projects/:projectId/endpoints', async (ctx) => {
    ctx.send(200, await deps.ingest.list(routeParam(ctx.params, 'projectId')));
  });

  router.route(
    'POST',
    '/v1/projects/:projectId/endpoints',
    async (ctx) => {
      const projectId = routeParam(ctx.params, 'projectId');
      ctx.send(200, await deps.ingest.up(projectId, readName(ctx.body)));
    },
    { body: 'json' },
  );

  router.route('POST', '/v1/projects/:projectId/endpoints/:name/close', async (ctx) => {
    const { projectId, name } = ids(ctx);
    ctx.send(200, await deps.ingest.down(projectId, name));
  });

  router.route(
    'POST',
    '/v1/projects/:projectId/endpoints/:name/rename',
    async (ctx) => {
      const { projectId, name } = ids(ctx);
      ctx.send(200, await deps.ingest.rename(projectId, name, readName(ctx.body)));
    },
    { body: 'json' },
  );

  router.route('DELETE', '/v1/projects/:projectId/endpoints/:name', async (ctx) => {
    const { projectId, name } = ids(ctx);
    await deps.ingest.remove(projectId, name);
    ctx.send(200, { ok: true });
  });

  router.route('GET', '/v1/projects/:projectId/endpoints/:name/events', async (ctx) => {
    const { projectId, name } = ids(ctx);
    ctx.send(200, await deps.ingest.tail(projectId, name, readLimit(ctx.query)));
  });

  router.route('GET', '/v1/projects/:projectId/endpoints/:name/stream', async (ctx) => {
    const { projectId, name } = ids(ctx);
    await deps.ingest.get(projectId, name);
    const sse = ctx.openSse();
    const unsubscribe = deps.hub.subscribe(endpointTopic(projectId, name), (message) => {
      sse.send('ingest', message);
    });
    sse.onClose(unsubscribe);
  });

  router.route(
    'OPTIONS',
    '/ingest/:token',
    (ctx) => {
      ctx.res.writeHead(204, CORS);
      ctx.res.end();
    },
    { auth: false },
  );

  router.route(
    'POST',
    '/ingest/:token',
    async (ctx) => {
      await deps.ingest.receive(routeParam(ctx.params, 'token'), ctx.body);
      ctx.send(202, { ok: true }, { 'access-control-allow-origin': '*' });
    },
    { auth: false, body: 'ingest' },
  );
}
