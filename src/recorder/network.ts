import type { BrowserContext, Request, Response } from 'playwright-core';
import type { EventInput } from '../core/events.ts';

const BODY_CAP = 64 * 1024;

function cap(text: string): string {
  return text.length > BODY_CAP ? text.slice(0, BODY_CAP) : text;
}

function skipUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

function jsonOrText(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return type.includes('json') || type.startsWith('text/');
}

function durationMs(request: Request, startedAt: number): number {
  const end = request.timing().responseEnd;
  if (end >= 0) return Math.round(end);
  return Math.max(0, Date.now() - startedAt);
}

export function attachNetwork(context: BrowserContext, onEvent: (event: EventInput) => void): void {
  const ids = new WeakMap<Request, string>();
  const started = new WeakMap<Request, number>();
  let next = 1;

  context.on('request', (request) => {
    const url = request.url();
    if (skipUrl(url)) return;
    const requestId = `r${next}`;
    next += 1;
    ids.set(request, requestId);
    started.set(request, Date.now());
    const event: EventInput = {
      kind: 'network',
      phase: 'request',
      requestId,
      method: request.method(),
      url,
    };
    const body = request.postData();
    if (body !== null) event.requestBody = cap(body);
    onEvent(event);
  });

  context.on('response', (response: Response) => {
    const request = response.request();
    const requestId = ids.get(request);
    if (requestId === undefined) return;
    const url = request.url();
    const startedAt = started.get(request) ?? Date.now();
    const event: EventInput = {
      kind: 'network',
      phase: 'response',
      requestId,
      method: request.method(),
      url,
      status: response.status(),
      durationMs: durationMs(request, startedAt),
    };
    void readResponseBody(request, response).then((body) => {
      if (body !== undefined) event.responseBody = body;
      onEvent(event);
    });
  });

  context.on('requestfailed', (request) => {
    const requestId = ids.get(request);
    if (requestId === undefined) return;
    const startedAt = started.get(request) ?? Date.now();
    const failure = request.failure();
    const event: EventInput = {
      kind: 'network',
      phase: 'failed',
      requestId,
      method: request.method(),
      url: request.url(),
      durationMs: durationMs(request, startedAt),
    };
    if (failure !== null) event.errorText = failure.errorText;
    onEvent(event);
  });
}

async function readResponseBody(request: Request, response: Response): Promise<string | undefined> {
  const resource = request.resourceType();
  if (resource !== 'fetch' && resource !== 'xhr') return undefined;
  if (!jsonOrText(response.headers()['content-type'] ?? '')) return undefined;
  try {
    return cap(await response.text());
  } catch {
    return undefined;
  }
}
