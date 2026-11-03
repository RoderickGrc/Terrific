import { TerrificError } from './errors.ts';
import { EVENT_KINDS, type EventKind, isErrorEvent, type TerrificEvent } from './events.ts';
import { parseOffset } from './format.ts';

export type EventQueryType = EventKind | 'errors';

export type EventQuery = {
  types?: EventQueryType[];
  around?: number;
  window?: number;
  at?: number;
  bodies?: boolean;
  limit?: number;
};

const DEFAULT_WINDOW_MS = 10_000;
const AT_WINDOW_MS = 1_000;
const WINDOW_RE = /^(\d+)(ms|s|m)$/;
const KIND_SET = new Set<string>(EVENT_KINDS);

function isEventKind(value: string): value is EventKind {
  return KIND_SET.has(value);
}

function invalid(name: string): never {
  throw new TerrificError('USAGE', `Invalid query parameter "${name}".`);
}

function parseWindow(raw: string): number {
  const match = WINDOW_RE.exec(raw.trim());
  if (!match) invalid('window');
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || unit === undefined) invalid('window');
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  return amount * 60_000;
}

function parseTypes(raw: string): EventQueryType[] {
  const types: EventQueryType[] = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (token === '') invalid('type');
    if (token === 'errors') {
      types.push('errors');
      continue;
    }
    if (!isEventKind(token)) invalid('type');
    types.push(token);
  }
  if (types.length === 0) invalid('type');
  return types;
}

function parseLimit(raw: string): number {
  if (!/^\d+$/.test(raw)) invalid('limit');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) invalid('limit');
  return value;
}

function parseBodies(raw: string): boolean {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  invalid('bodies');
}

export function parseEventQuery(params: URLSearchParams): EventQuery {
  const query: EventQuery = {};
  const type = params.get('type');
  if (type !== null) query.types = parseTypes(type);
  const around = params.get('around');
  if (around !== null) {
    const ms = parseOffset(around);
    if (ms === null) invalid('around');
    query.around = ms;
  }
  const window = params.get('window');
  if (window !== null) query.window = parseWindow(window);
  const at = params.get('at');
  if (at !== null) {
    const ms = parseOffset(at);
    if (ms === null) invalid('at');
    query.at = ms;
  }
  const bodies = params.get('bodies');
  if (bodies !== null) query.bodies = parseBodies(bodies);
  const limit = params.get('limit');
  if (limit !== null) query.limit = parseLimit(limit);
  if (query.at !== undefined) query.bodies = true;
  return query;
}

function keepType(event: TerrificEvent, types: EventQueryType[] | undefined): boolean {
  if (types === undefined || types.length === 0) return true;
  for (const type of types) {
    if (type === 'errors') {
      if (isErrorEvent(event)) return true;
    } else if (event.kind === type) {
      return true;
    }
  }
  return false;
}

function stripBodies(event: TerrificEvent): TerrificEvent {
  if (event.kind === 'network') {
    const copy = { ...event };
    delete copy.requestBody;
    delete copy.responseBody;
    return copy;
  }
  if (event.kind === 'snapshot') {
    // markdown is required by the type; an empty string keeps the shape and wordCount says
    // how much was left out.
    return { ...event, markdown: '' };
  }
  return event;
}

export function queryEvents(events: readonly TerrificEvent[], query: EventQuery): TerrificEvent[] {
  const windowMs = query.window ?? DEFAULT_WINDOW_MS;
  let out = events.filter((event) => keepType(event, query.types));
  if (query.around !== undefined) {
    const lo = query.around - windowMs;
    const hi = query.around + windowMs;
    out = out.filter((event) => event.t >= lo && event.t <= hi);
  }
  if (query.at !== undefined) {
    const at = query.at;
    out = out.filter((event) => Math.abs(event.t - at) <= AT_WINDOW_MS);
  }
  const withBodies = query.bodies === true;
  if (!withBodies) out = out.map(stripBodies);
  if (query.limit !== undefined) out = out.slice(-query.limit);
  return out;
}
