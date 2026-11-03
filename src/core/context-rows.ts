import type { ExportItem } from './context-heuristics.ts';
import { isViteBurst } from './context-heuristics.ts';
import {
  compactBody,
  compactIngestData,
  flattenSnapshotMarkdown,
  summarizeResponseBody,
} from './context-payload.ts';
import type {
  ActionEvent,
  ConsoleEvent,
  IngestEvent,
  SnapshotEvent,
  TerrificEvent,
} from './events.ts';
import { DEFAULT_MARK_TEXT } from './events.ts';
import { formatOffset } from './format.ts';
import type { NetworkRequest } from './network.ts';
import { foldNetwork } from './network.ts';
import { redactText, redactUrl, redactValue } from './redaction.ts';

export type ContextRow = {
  t: string;
  type: string;
  msg: string;
  val?: string;
  target?: { label?: string; selector?: string };
  status?: number;
  ms?: number;
  body?: unknown;
  response?: unknown;
  error?: string;
  level?: string;
  title?: string;
  url?: string;
  content?: string;
  unchanged?: boolean;
  file?: string;
  endpoint?: string;
  source?: string;
  diagnosticSlug?: string;
  data?: unknown;
};

const TYPE_BY_KIND = {
  action: 'ACT',
  network: 'NET',
  console: 'CON',
  navigation: 'RELOAD',
  snapshot: 'SNAP',
  screenshot: 'SHOT',
  note: 'NOTE',
  bug: 'BUG',
  flag: 'FLAG',
  ingest: 'SVR',
} as const;

function actionMsg(event: ActionEvent): string {
  const label = event.target.label;
  return label === undefined || label === '' ? event.action : `${event.action} "${label}"`;
}

function actionRow(event: ActionEvent): ContextRow {
  const row: ContextRow = {
    t: formatOffset(event.t),
    type: TYPE_BY_KIND.action,
    msg: actionMsg(event),
  };
  if (event.masked) {
    row.val = `<${event.valueLength ?? 0} chars hidden>`;
  } else if (event.value !== undefined && event.value !== '') {
    const redacted = redactText(event.value);
    row.val = typeof redacted === 'string' ? redacted : event.value;
  }
  const target: { label?: string; selector?: string } = {};
  if (event.target.label) target.label = event.target.label;
  if (event.target.selector) target.selector = event.target.selector;
  if (Object.keys(target).length > 0) row.target = target;
  return row;
}

function networkRow(request: NetworkRequest): ContextRow {
  const row: ContextRow = {
    t: formatOffset(request.startT),
    type: TYPE_BY_KIND.network,
    msg: `${request.method} ${redactUrl(request.url)}`,
  };
  if (request.status !== undefined) row.status = request.status;
  if (request.durationMs !== undefined) row.ms = request.durationMs;
  if (request.requestBody !== undefined && request.requestBody !== '') {
    row.body = compactBody(redactText(request.requestBody));
  }
  if (request.responseBody !== undefined && request.responseBody !== '') {
    row.response = summarizeResponseBody(redactText(request.responseBody));
  }
  if (request.failed) row.error = request.errorText ?? 'failed';
  return row;
}

function consoleRow(event: ConsoleEvent): ContextRow {
  const row: ContextRow = {
    t: formatOffset(event.t),
    type: TYPE_BY_KIND.console,
    msg: event.text,
  };
  if (event.level !== 'log') row.level = event.level;
  return row;
}

function ingestRow(event: IngestEvent): ContextRow {
  const row: ContextRow = {
    t: formatOffset(event.t),
    type: TYPE_BY_KIND.ingest,
    msg: event.message,
    endpoint: event.endpoint,
    level: event.level,
  };
  if (event.source) row.source = event.source;
  if (event.diagnosticSlug) row.diagnosticSlug = event.diagnosticSlug;
  if (event.data !== undefined) {
    const data = compactIngestData(redactValue(event.data));
    if (data !== undefined) row.data = data;
  }
  return row;
}

// The row shape is the same whether or not the page changed, so agents can scan by msg and url.
function snapshotRow(event: SnapshotEvent, unchanged: boolean): ContextRow {
  const row: ContextRow = {
    t: formatOffset(event.t),
    type: TYPE_BY_KIND.snapshot,
    msg: event.title || 'Page snapshot',
    url: redactUrl(event.url),
  };
  if (unchanged) row.unchanged = true;
  else row.content = flattenSnapshotMarkdown(event.markdown);
  return row;
}

export function eventsToRows(items: readonly ExportItem[]): ContextRow[] {
  const events = items.filter((item): item is TerrificEvent => !isViteBurst(item));
  const folded = foldNetwork(events);
  const foldedById = new Map(folded.map((row) => [row.requestId, row]));
  const seenNetwork = new Set<string>();
  const rows: ContextRow[] = [];
  let previousMarkdown: string | null = null;

  for (const item of items) {
    if (isViteBurst(item)) {
      rows.push({
        t: formatOffset(item.t),
        type: TYPE_BY_KIND.network,
        msg: `Vite dev reload burst collapsed (${item.count} requests)`,
      });
      continue;
    }
    if (item.kind === 'lifecycle') continue;
    if (item.kind === 'network') {
      if (seenNetwork.has(item.requestId)) continue;
      seenNetwork.add(item.requestId);
      const request = foldedById.get(item.requestId);
      if (request !== undefined) rows.push(networkRow(request));
      continue;
    }
    if (item.kind === 'action') {
      rows.push(actionRow(item));
      continue;
    }
    if (item.kind === 'console') {
      rows.push(consoleRow(item));
      continue;
    }
    if (item.kind === 'navigation') {
      const row: ContextRow = {
        t: formatOffset(item.t),
        type: TYPE_BY_KIND.navigation,
        msg: redactUrl(item.url),
      };
      if (item.title) row.title = item.title;
      rows.push(row);
      continue;
    }
    if (item.kind === 'snapshot') {
      const unchanged = previousMarkdown !== null && previousMarkdown === item.markdown;
      rows.push(snapshotRow(item, unchanged));
      previousMarkdown = item.markdown;
      continue;
    }
    if (item.kind === 'screenshot') {
      rows.push({
        t: formatOffset(item.t),
        type: TYPE_BY_KIND.screenshot,
        msg: 'Screenshot',
        file: item.file,
      });
      continue;
    }
    if (item.kind === 'note') {
      rows.push({ t: formatOffset(item.t), type: TYPE_BY_KIND.note, msg: item.text });
      continue;
    }
    if (item.kind === 'bug' || item.kind === 'flag') {
      rows.push({
        t: formatOffset(item.t),
        type: item.kind === 'bug' ? TYPE_BY_KIND.bug : TYPE_BY_KIND.flag,
        msg: item.text ?? DEFAULT_MARK_TEXT[item.kind],
      });
      continue;
    }
    rows.push(ingestRow(item));
  }
  return rows;
}

export function actionLine(event: ActionEvent): string {
  return actionMsg(event);
}
