import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { TerrificError } from '../core/errors.ts';
import { mapError, matchPath } from './http.ts';

test('matchPath binds colon params and rejects a different shape', () => {
  const pattern = '/v1/projects/:projectId/endpoints/:name';
  deepEqual(matchPath(pattern, '/v1/projects/k2m8q4zx/endpoints/app'), {
    projectId: 'k2m8q4zx',
    name: 'app',
  });
  deepEqual(matchPath('/ingest/:token', '/ingest/ing_abc'), { token: 'ing_abc' });
  equal(matchPath('/v1/projects/:projectId', '/v1/projects/k2m8q4zx/endpoints'), null);
  equal(matchPath('/v1/health', '/v1/projects'), null);
  deepEqual(matchPath('/v1/health', '/v1/health'), {});
});

test('matchPath decodes a param and fails on a bad encoding', () => {
  const pattern = '/v1/projects/:projectId/endpoints/:name';
  deepEqual(matchPath(pattern, '/v1/projects/k2m8q4zx/endpoints/my-app'), {
    projectId: 'k2m8q4zx',
    name: 'my-app',
  });
  equal(matchPath('/ingest/:token', '/ingest/%E0%A4%A'), null);
});

test('mapError uses TerrificError codes and hides unexpected stacks', () => {
  const rows = [
    ['USAGE', 400],
    ['INVALID_INPUT', 400],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['ENDPOINT_CLOSED', 410],
    ['INTERNAL', 500],
  ] as const;
  for (const [code, status] of rows) {
    const mapped = mapError(new TerrificError(code, `${code} happened.`));
    equal(mapped.status, status);
    deepEqual(mapped.body, { error: { code, message: `${code} happened.` } });
  }
  const unexpected = mapError(new Error('secret stack'));
  equal(unexpected.status, 500);
  deepEqual(unexpected.body, {
    error: { code: 'INTERNAL', message: 'An internal error occurred.' },
  });
});
