import {
  type ActionName,
  type ConsoleLevel,
  DEFAULT_MARK_TEXT,
  type EventInput,
  type IngestLevel,
  type NetworkPhase,
  type TerrificEvent,
} from '../core/events.ts';
import { isRecord, isString } from '../core/validate.ts';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const REQUEST_LINE = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i;
const RESPONSE_LINE = /^(\d{3})\s+(\S+)/;
const CONSOLE_LINE = /^Console\s+(\w+):\s*/i;
const ACTION_NAMES: ReadonlySet<string> = new Set([
  'click',
  'input',
  'change',
  'select',
  'submit',
  'keydown',
]);
const VOLATILE_QUERY = new Set(['t', 'v']);
const JSON_BAD = Symbol('json-bad');

export type ConvertedLegacy = { events: TerrificEvent[]; skipped: number };

type Net = {
  kind: 'request' | 'response' | 'unknown';
  method?: string;
  url?: string;
  status?: number;
  requestBody?: string;
  responseBody?: string;
  errorText?: string;
  failed: boolean;
  matchKey?: string;
  urlKey?: string;
};

function iso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value: unknown): unknown {
  if (!isString(value)) return undefined;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function needJson(value: unknown): unknown | typeof JSON_BAD {
  if (value === undefined) return JSON_BAD;
  const parsed = parseJson(value);
  return parsed === undefined ? JSON_BAD : parsed;
}

function statusOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (isString(value) && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function methodOf(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const upper = value.trim().toUpperCase();
  return HTTP_METHODS.has(upper) ? upper : undefined;
}

function urlOf(value: unknown): string | undefined {
  return isString(value) && value.trim() !== '' ? value.trim() : undefined;
}

function bodyOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return isString(value) ? value : JSON.stringify(value);
}

// The old pairing ignored cache-buster query keys so a request still matched its response.
function matchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://localhost');
  } catch {
    return url.trim();
  }
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !VOLATILE_QUERY.has(key.toLowerCase()))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const search = query === '' ? '' : `?${query}`;
  const path = parsed.pathname || '/';
  return /^https?:\/\//i.test(url.trim())
    ? `${parsed.protocol}//${parsed.host}${path}${search}`
    : `${path}${search}`;
}

function parseNet(message: string, detailsRaw: unknown): Net | typeof JSON_BAD {
  let details: Record<string, unknown> | undefined;
  if (isString(detailsRaw) && /^\s*[[{]/.test(detailsRaw)) {
    const parsed = parseJson(detailsRaw);
    if (parsed === undefined) return JSON_BAD;
    if (isRecord(parsed)) details = parsed;
  } else if (isRecord(detailsRaw)) {
    details = detailsRaw;
  }
  const req = REQUEST_LINE.exec(message);
  const res = RESPONSE_LINE.exec(message);
  const method = methodOf(req?.[1]) ?? methodOf(details?.method);
  const url = urlOf(req?.[2]) ?? urlOf(res?.[2]) ?? urlOf(details?.url);
  const status = statusOf(res?.[1]) ?? statusOf(details?.status);
  let kind: Net['kind'] = 'unknown';
  if (req) kind = 'request';
  else if (res || status !== undefined) kind = 'response';
  else if (method) kind = 'request';
  const urlKey = url === undefined ? undefined : matchUrl(url);
  return {
    kind,
    method,
    url,
    status,
    requestBody: bodyOf(details?.body),
    responseBody: bodyOf(details?.responseBody),
    errorText: isString(details?.errorText) ? details.errorText : undefined,
    failed:
      details?.failed === true ||
      isString(details?.error) ||
      isString(details?.errorText) ||
      status === 0,
    matchKey: method && urlKey ? `${method} ${urlKey}` : undefined,
    urlKey,
  };
}

function pairIds(rows: Array<Net | undefined>): string[] {
  const pending = new Map<string, number[]>();
  const linked = new Map<number, number>();
  for (const [index, item] of rows.entries()) {
    if (!item) continue;
    if (item.kind === 'request' && item.matchKey) {
      const queue = pending.get(item.matchKey) ?? [];
      queue.push(index);
      pending.set(item.matchKey, queue);
      continue;
    }
    if (item.kind !== 'response') continue;
    let match = item.matchKey ? pending.get(item.matchKey)?.shift() : undefined;
    if (match === undefined && item.urlKey) {
      let oldest: number | undefined;
      let oldestKey: string | undefined;
      for (const [key, queue] of pending) {
        const first = queue[0];
        if (first === undefined || rows[first]?.urlKey !== item.urlKey) continue;
        if (oldest === undefined || first < oldest) {
          oldest = first;
          oldestKey = key;
        }
      }
      if (oldest !== undefined && oldestKey !== undefined) {
        pending.get(oldestKey)?.shift();
        match = oldest;
      }
    }
    if (match !== undefined) linked.set(match, index);
  }
  const assigned = new Map<number, string>();
  let n = 1;
  for (const [index, item] of rows.entries()) {
    if (item?.kind !== 'request') continue;
    const id = `legacy-${n}`;
    n += 1;
    assigned.set(index, id);
    const other = linked.get(index);
    if (other !== undefined) assigned.set(other, id);
  }
  for (const [index, item] of rows.entries()) {
    if (item?.kind === 'response' && !assigned.has(index)) {
      assigned.set(index, `legacy-${n}`);
      n += 1;
    }
  }
  return rows.map((_, index) => assigned.get(index) ?? '');
}

function isSelectElement(details: Record<string, unknown>): boolean {
  if (details.element === 'SELECT') return true;
  return isString(details.tagName) && details.tagName.toUpperCase() === 'SELECT';
}

function actionOf(details: Record<string, unknown>, message: string): ActionName | null {
  const named = isString(details.action)
    ? details.action
    : isString(details.type)
      ? details.type
      : undefined;
  let guessed: ActionName | undefined;
  if (/^Clicked:/i.test(message)) guessed = 'click';
  else if (/^Typed in:/i.test(message)) guessed = 'input';
  else if (/^Changed:/i.test(message)) guessed = 'change';
  const name = named ?? guessed;
  if (!name) return null;
  if (name === 'change' && (isString(details.selectedText) || isSelectElement(details))) {
    return 'select';
  }
  return isActionName(name) ? name : null;
}

function actionLabel(details: Record<string, unknown>, message: string): string | undefined {
  if (isString(details.text)) {
    const text = details.text.trim();
    if (text !== '') return text.slice(0, 80);
  }
  if (isString(details.id)) {
    const id = details.id.trim();
    if (id !== '') return id;
  }
  return /:\s*"([\s\S]*)"$/.exec(message)?.[1];
}

function actionSelector(details: Record<string, unknown>): string | undefined {
  if (isString(details.selector) && details.selector !== '') return details.selector;
  const tag =
    isString(details.tagName) && details.tagName.trim() !== ''
      ? details.tagName.trim().toLowerCase()
      : '';
  const id = isString(details.id) && details.id.trim() !== '' ? `#${details.id.trim()}` : '';
  const classes = isString(details.className)
    ? details.className
        .trim()
        .split(/\s+/)
        .filter((name) => name !== '')
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('')
    : '';
  const selector = `${tag}${id}${classes}`;
  return selector === '' ? undefined : selector;
}

function isActionName(value: string): value is ActionName {
  return ACTION_NAMES.has(value);
}

function consoleLevel(value: string | undefined): ConsoleLevel {
  if (value === 'warning' || value === 'warn') return 'warn';
  if (value === 'info' || value === 'error' || value === 'debug' || value === 'log') return value;
  return 'log';
}

function ingestLevel(value: unknown): IngestLevel {
  if (!isString(value)) return 'info';
  const lower = value.toLowerCase();
  if (lower === 'warning' || lower === 'warn') return 'warn';
  if (lower === 'log') return 'info';
  if (lower === 'debug' || lower === 'info' || lower === 'error') return lower;
  return 'info';
}

type Built = EventInput & { id: string };

function build(
  type: string,
  id: string,
  message: string,
  detailsRaw: unknown,
  net: Net | undefined,
  requestId: string,
): Built | typeof JSON_BAD | null {
  if (type === 'ACTION') {
    const details = needJson(detailsRaw);
    if (details === JSON_BAD || !isRecord(details)) return details === JSON_BAD ? JSON_BAD : null;
    const action = actionOf(details, message);
    if (!action) return null;
    const masked = details.masked === true || details.inputType === 'password';
    const fromSelect = isString(details.selectedText) ? details.selectedText : undefined;
    const fromValue = isString(details.value) ? details.value : undefined;
    const chosen = fromSelect ?? fromValue;
    const label = actionLabel(details, message);
    const selector = actionSelector(details);
    const event: Built = {
      id,
      kind: 'action',
      action,
      target: {
        ...(label !== undefined ? { label } : {}),
        ...(selector !== undefined ? { selector } : {}),
        ...(isString(details.xpath) ? { xpath: details.xpath } : {}),
      },
      masked,
    };
    if (masked) {
      const length = typeof details.valueLength === 'number' ? details.valueLength : chosen?.length;
      return length === undefined ? event : { ...event, valueLength: length };
    }
    return chosen === undefined ? event : { ...event, value: chosen };
  }
  if (type === 'NETWORK') {
    if (!net || (net.method === undefined && net.url === undefined)) return null;
    let phase: NetworkPhase = 'response';
    if (net.failed) phase = 'failed';
    else if (net.kind === 'request') phase = 'request';
    return {
      id,
      kind: 'network',
      phase,
      requestId,
      method: net.method ?? '',
      url: net.url ?? '',
      ...(net.status !== undefined ? { status: net.status } : {}),
      ...(net.requestBody !== undefined ? { requestBody: net.requestBody } : {}),
      ...(net.responseBody !== undefined ? { responseBody: net.responseBody } : {}),
      ...(net.errorText !== undefined ? { errorText: net.errorText } : {}),
    };
  }
  if (type === 'CONSOLE') {
    const match = CONSOLE_LINE.exec(message);
    return {
      id,
      kind: 'console',
      level: consoleLevel(match?.[1]),
      text: isString(detailsRaw) ? detailsRaw : match ? message.slice(match[0].length) : message,
    };
  }
  if (type === 'PAGE_RELOAD') {
    const details = detailsRaw === undefined ? {} : needJson(detailsRaw);
    if (details === JSON_BAD) return JSON_BAD;
    const rec = isRecord(details) ? details : {};
    return {
      id,
      kind: 'navigation',
      url: isString(rec.url) ? rec.url : message.replace(/^Page reloaded:\s*/i, '').trim(),
      title: isString(rec.title) ? rec.title : '',
    };
  }
  if (type === 'SNAPSHOT' || type === 'CRAWL') {
    const details = needJson(detailsRaw);
    if (details === JSON_BAD) return JSON_BAD;
    const rec = isRecord(details) ? details : {};
    return {
      id,
      kind: 'snapshot',
      url: isString(rec.url) ? rec.url : '',
      title: isString(rec.title) ? rec.title : '',
      wordCount: typeof rec.wordCount === 'number' ? rec.wordCount : 0,
      markdown: isString(rec.markdown) ? rec.markdown : '',
    };
  }
  if (type === 'SCREENSHOT') {
    const details = needJson(detailsRaw);
    if (details === JSON_BAD || !isRecord(details)) return details === JSON_BAD ? JSON_BAD : null;
    const file = isString(details.filename) ? details.filename : urlOf(details.file);
    if (!file) return null;
    const bytes =
      typeof details.size === 'number'
        ? details.size
        : typeof details.bytes === 'number'
          ? details.bytes
          : 0;
    return { id, kind: 'screenshot', file, bytes };
  }
  if (type === 'NOTE') {
    return message.trim() === '' ? null : { id, kind: 'note', text: message, author: 'tester' };
  }
  if (type === 'BUG' || type === 'FLAG') {
    const def = type === 'BUG' ? DEFAULT_MARK_TEXT.bug : DEFAULT_MARK_TEXT.flag;
    return {
      id,
      kind: type === 'BUG' ? 'bug' : 'flag',
      text: message.trim() === '' || message === def ? null : message,
      author: 'tester',
    };
  }
  if (type === 'SERVER_LOG') {
    const details = detailsRaw === undefined ? {} : needJson(detailsRaw);
    if (details === JSON_BAD) return JSON_BAD;
    const rec = isRecord(details) ? details : {};
    const source = isString(rec.source) ? rec.source : urlOf(rec.src);
    const clientTime = rec.timestamp === undefined ? undefined : iso(String(rec.timestamp));
    return {
      id,
      kind: 'ingest',
      endpoint: 'legacy',
      message,
      level: ingestLevel(rec.level ?? rec.lvl),
      ...(source ? { source } : {}),
      ...(isString(rec.diagnosticSlug) ? { diagnosticSlug: rec.diagnosticSlug } : {}),
      ...(clientTime ? { clientTime } : {}),
      ...(Object.hasOwn(rec, 'data') ? { data: rec.data } : {}),
    };
  }
  if (type === 'SESSION_STOPPED') return { id, kind: 'lifecycle', state: 'stopped' };
  return null;
}

export function convertLegacyEvents(raw: unknown[], sessionStartMs: number): ConvertedLegacy {
  type Row = {
    id: string;
    type: string;
    message: string;
    details: unknown;
    at: string;
    ms: number;
  };
  const rows: Row[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (
      !isRecord(item) ||
      !isString(item.id) ||
      !isString(item.type) ||
      !isString(item.timestamp)
    ) {
      skipped += 1;
      continue;
    }
    const at = iso(item.timestamp);
    if (!at) {
      skipped += 1;
      continue;
    }
    rows.push({
      id: item.id,
      type: item.type,
      message: isString(item.message) ? item.message : '',
      details: item.details,
      at,
      ms: new Date(at).getTime(),
    });
  }
  rows.sort((a, b) => a.ms - b.ms);
  const nets: Array<Net | undefined> = [];
  const badNet = new Set<number>();
  for (const [index, row] of rows.entries()) {
    if (row.type !== 'NETWORK') {
      nets.push(undefined);
      continue;
    }
    const parsed = parseNet(row.message, row.details);
    if (parsed === JSON_BAD) {
      badNet.add(index);
      nets.push(undefined);
      continue;
    }
    nets.push(parsed);
  }
  const ids = pairIds(nets);
  const events: TerrificEvent[] = [];
  for (const [index, row] of rows.entries()) {
    if (badNet.has(index)) {
      skipped += 1;
      continue;
    }
    const built = build(row.type, row.id, row.message, row.details, nets[index], ids[index] ?? '');
    if (built === JSON_BAD || built === null) {
      skipped += 1;
      continue;
    }
    events.push({
      ...built,
      seq: events.length,
      at: row.at,
      t: Math.max(0, row.ms - sessionStartMs),
    });
  }
  return { events, skipped };
}

export function foldedConvertedCount(events: readonly TerrificEvent[]): number {
  const ids = new Set<string>();
  let others = 0;
  for (const event of events) {
    if (event.kind === 'network') ids.add(event.requestId);
    else others += 1;
  }
  return others + ids.size;
}

export function pairedResponseCount(events: readonly TerrificEvent[]): number {
  const requests = new Set(
    events.flatMap((event) =>
      event.kind === 'network' && event.phase === 'request' ? [event.requestId] : [],
    ),
  );
  return events.filter(
    (event) =>
      event.kind === 'network' && event.phase !== 'request' && requests.has(event.requestId),
  ).length;
}
