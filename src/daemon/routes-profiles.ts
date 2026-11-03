import type { CreateProfileRequest } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { isBrowserId, isProfileMode } from '../core/profiles.ts';
import { isRecord, isString } from '../core/validate.ts';
import { type Router, routeParam } from './http.ts';
import type { ProfileService } from './profile-service.ts';

export type ProfileRouteDeps = {
  profiles: ProfileService;
};

function optionalUrl(body: unknown): string | undefined {
  if (!isRecord(body) || body.url === undefined) return undefined;
  if (!isString(body.url)) throw new TerrificError('USAGE', 'url must be a string.');
  return body.url;
}

function readCreate(body: unknown): CreateProfileRequest {
  if (!isRecord(body) || !isString(body.name)) {
    throw new TerrificError('USAGE', 'name is required.');
  }
  if (!isProfileMode(body.mode)) {
    throw new TerrificError('USAGE', 'mode must be persistent or snapshot.');
  }
  const request: CreateProfileRequest = { name: body.name, mode: body.mode };
  if (body.browser !== undefined) {
    if (!isBrowserId(body.browser)) {
      throw new TerrificError('USAGE', 'browser must be chrome, edge, chromium or comet.');
    }
    request.browser = body.browser;
  }
  const url = optionalUrl(body);
  if (url !== undefined) request.url = url;
  return request;
}

function readNewName(body: unknown): string {
  if (!isRecord(body) || !isString(body.name)) {
    throw new TerrificError('USAGE', 'name is required.');
  }
  return body.name;
}

export function registerProfileRoutes(router: Router, deps: ProfileRouteDeps): void {
  router.route('GET', '/v1/profiles', async (ctx) => {
    ctx.send(200, await deps.profiles.list());
  });

  router.route(
    'POST',
    '/v1/profiles',
    async (ctx) => {
      ctx.send(200, await deps.profiles.create(readCreate(ctx.body)));
    },
    { body: 'json' },
  );

  router.route(
    'POST',
    '/v1/profiles/:name/rename',
    async (ctx) => {
      const name = routeParam(ctx.params, 'name');
      ctx.send(200, await deps.profiles.rename(name, readNewName(ctx.body)));
    },
    { body: 'json' },
  );

  router.route('DELETE', '/v1/profiles/:name', async (ctx) => {
    await deps.profiles.remove(routeParam(ctx.params, 'name'));
    ctx.send(200, { ok: true });
  });

  router.route(
    'POST',
    '/v1/profiles/:name/open',
    async (ctx) => {
      const name = routeParam(ctx.params, 'name');
      ctx.send(200, await deps.profiles.open(name, optionalUrl(ctx.body)));
    },
    { body: 'json' },
  );

  router.route('POST', '/v1/profiles/:name/close', async (ctx) => {
    ctx.send(200, await deps.profiles.close(routeParam(ctx.params, 'name')));
  });
}
