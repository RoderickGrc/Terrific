import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ApiError, MAX_BODY_BYTES } from '../core/api.ts';
import { type ErrorCode, isTerrificError, TerrificError } from '../core/errors.ts';
import { openSse, type SseWriter } from './sse.ts';

export type { SseWriter };

export type RouteParams = Record<string, string>;
export type JsonHeaders = Record<string, string>;

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  params: RouteParams;
  query: URLSearchParams;
  body: unknown;
  send(status: number, body: unknown, headers?: JsonHeaders): void;
  openSse(): SseWriter;
};

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export type RouteOptions = {
  auth?: boolean;
  body?: 'json' | 'ingest' | false;
};

export type Router = {
  route(method: string, pattern: string, handler: RouteHandler, options?: RouteOptions): void;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  closeConnections(): void;
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  USAGE: 400,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ENDPOINT_CLOSED: 410,
  INTERNAL: 500,
};

export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const expected = pattern.split('/').filter((part) => part !== '');
  const actual = pathname.split('/').filter((part) => part !== '');
  if (expected.length !== actual.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i];
    const got = actual[i];
    if (want === undefined || got === undefined) return null;
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
      continue;
    }
    if (want !== got) return null;
  }
  return params;
}

export function mapError(error: unknown): { status: number; body: ApiError } {
  if (isTerrificError(error)) {
    return {
      status: STATUS_BY_CODE[error.code],
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'An internal error occurred.' } },
  };
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: JsonHeaders,
): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const normalized = host.trim().toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

export function bearerMatches(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const prefix = 'bearer ';
  if (!header.toLowerCase().startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds 1 MB.');
    this.name = 'BodyTooLargeError';
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mimeType(header: string | undefined): string {
  if (header === undefined) return '';
  const raw = header.split(';')[0];
  return raw === undefined ? '' : raw.trim().toLowerCase();
}

export async function readJsonBody(
  req: IncomingMessage,
  mode: 'json' | 'ingest',
): Promise<unknown> {
  const type = mimeType(headerValue(req.headers['content-type']));
  const json = type === '' || type === 'application/json';
  const ok = json || (mode === 'ingest' && type === 'text/plain');
  if (!ok) {
    throw new TerrificError('INVALID_INPUT', 'Content-Type must be application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  // An empty body reaches handlers as undefined, so body-less calls like `stop` need no `{}`.
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new TerrificError('INVALID_INPUT', 'Body is not valid JSON.');
  }
}

function writeError(
  res: ServerResponse,
  error: unknown,
  log: { error(message: string, err?: unknown): void },
): void {
  if (error instanceof BodyTooLargeError) {
    sendJson(res, 413, { error: { code: 'INVALID_INPUT', message: error.message } });
    return;
  }
  if (!isTerrificError(error) || error.code === 'INTERNAL') {
    log.error(error instanceof Error ? error.message : 'error', error);
  }
  const mapped = mapError(error);
  sendJson(res, mapped.status, mapped.body);
}

type StoredRoute = {
  method: string;
  pattern: string;
  handler: RouteHandler;
  body: 'json' | 'ingest' | false;
};

export function createRouter(options: {
  token: string;
  getPort: () => number;
  log: { error(message: string, err?: unknown): void };
}): Router {
  const routes: StoredRoute[] = [];
  const connections = new Set<SseWriter>();

  return {
    route(method, pattern, handler, routeOptions) {
      routes.push({
        method,
        pattern,
        handler,
        body: routeOptions?.body ?? false,
      });
    },
    async handle(req, res) {
      try {
        if (!isAllowedHost(headerValue(req.headers.host), options.getPort())) {
          sendJson(res, 421, { error: { code: 'USAGE', message: 'Invalid Host header.' } });
          return;
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const method = (req.method ?? 'GET').toUpperCase();
        if (
          !url.pathname.startsWith('/ingest/') &&
          !bearerMatches(headerValue(req.headers.authorization), options.token)
        ) {
          sendJson(res, 401, { error: { code: 'USAGE', message: 'Authorization required.' } });
          return;
        }
        const found = routes.find(
          (route) => route.method === method && matchPath(route.pattern, url.pathname) !== null,
        );
        if (found === undefined) {
          writeError(res, new TerrificError('NOT_FOUND', 'Not found.'), options.log);
          return;
        }
        const params = matchPath(found.pattern, url.pathname) ?? {};
        const body = found.body === false ? undefined : await readJsonBody(req, found.body);
        await found.handler({
          req,
          res,
          params,
          query: url.searchParams,
          body,
          send(status, payload, headers) {
            sendJson(res, status, payload, headers);
          },
          openSse() {
            const sse = openSse(req, res);
            connections.add(sse);
            sse.onClose(() => {
              connections.delete(sse);
            });
            return sse;
          },
        });
      } catch (error) {
        writeError(res, error, options.log);
      }
    },
    closeConnections() {
      for (const conn of connections) conn.close();
      connections.clear();
    },
  };
}

export function routeParam(params: RouteParams, key: string): string {
  const value = params[key];
  if (value === undefined) {
    throw new TerrificError('INTERNAL', `Missing route parameter "${key}".`);
  }
  return value;
}
