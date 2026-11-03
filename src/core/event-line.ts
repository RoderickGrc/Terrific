import type { ActionEvent, NetworkEvent, TerrificEvent } from './events.ts';
import { DEFAULT_MARK_TEXT, isErrorEvent } from './events.ts';
import { formatOffset, truncateMiddle } from './format.ts';

export type EventLineTag =
  | 'net'
  | 'log'
  | 'act'
  | 'nav'
  | 'shot'
  | 'snap'
  | 'ingest'
  | 'note'
  | 'bug'
  | 'flag'
  | 'life';

export type EventLineTone = 'normal' | 'error' | 'warn' | 'muted';

export type EventLine = {
  tag: EventLineTag;
  content: string;
  detail: string;
  tone: EventLineTone;
};

const TAG_WIDTH = 6;
const HOST_MAX = 24;

function fileName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] ?? file;
}

function actionLabel(event: ActionEvent): string {
  const label = event.target.label ?? event.target.selector;
  return label === undefined || label === '' ? 'element' : `"${label}"`;
}

function actionLine(event: ActionEvent): EventLine {
  const label = actionLabel(event);
  if (event.action === 'click') {
    return { tag: 'act', content: `click ${label}`, detail: '', tone: 'normal' };
  }
  if (event.action === 'select') {
    const value = event.value ?? '';
    return { tag: 'act', content: `select ${label} = ${value}`, detail: '', tone: 'normal' };
  }
  if (event.action === 'input' || event.action === 'change') {
    if (event.masked) {
      const n = event.valueLength ?? 0;
      return {
        tag: 'act',
        content: `type ${label} (${n} chars hidden)`,
        detail: '',
        tone: 'normal',
      };
    }
    const value = event.value ?? '';
    return { tag: 'act', content: `type ${label} = ${value}`, detail: '', tone: 'normal' };
  }
  const extra = event.value === undefined || event.value === '' ? '' : ` = ${event.value}`;
  return { tag: 'act', content: `${event.action} ${label}${extra}`, detail: '', tone: 'normal' };
}

function shortenHost(host: string): string {
  return truncateMiddle(host, HOST_MAX);
}

function networkTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return `${shortenHost(parsed.host)}${path === '' ? '/' : path}`;
  } catch {
    return truncateMiddle(url, 48);
  }
}

function networkLine(event: NetworkEvent): EventLine {
  const content = `${event.method} ${networkTarget(event.url)}`;
  if (event.phase === 'failed' || isErrorEvent(event)) {
    const status = event.status === undefined ? 'failed' : String(event.status);
    const ms = event.durationMs === undefined ? '' : ` · ${event.durationMs}ms`;
    const failed = event.phase === 'failed' && event.status === undefined;
    const detail = failed ? (event.errorText ?? 'failed') : `${status}${ms}`;
    return { tag: 'net', content, detail, tone: 'error' };
  }
  if (event.phase === 'request' && event.status === undefined) {
    return { tag: 'net', content, detail: 'pending', tone: 'normal' };
  }
  const status = event.status === undefined ? '' : String(event.status);
  const gap = status === '' ? '' : ' · ';
  const ms = event.durationMs === undefined ? '' : `${gap}${event.durationMs}ms`;
  return { tag: 'net', content, detail: `${status}${ms}`.trim(), tone: 'normal' };
}

function markLine(kind: 'note' | 'bug' | 'flag', text: string | null): EventLine {
  if (kind === 'note') {
    return { tag: 'note', content: text ?? '', detail: '', tone: 'normal' };
  }
  const fallback = DEFAULT_MARK_TEXT[kind];
  if (text === null || text === '') {
    return { tag: kind, content: fallback, detail: '', tone: 'muted' };
  }
  return { tag: kind, content: text, detail: '', tone: 'normal' };
}

export function describeEvent(event: TerrificEvent): EventLine {
  switch (event.kind) {
    case 'network':
      return networkLine(event);
    case 'console': {
      const tone: EventLineTone =
        event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'normal';
      return { tag: 'log', content: event.text, detail: event.level, tone };
    }
    case 'action':
      return actionLine(event);
    case 'navigation':
      return { tag: 'nav', content: event.url, detail: event.title, tone: 'normal' };
    case 'snapshot':
      return {
        tag: 'snap',
        content: event.title,
        detail: `${event.wordCount} words`,
        tone: 'normal',
      };
    case 'screenshot':
      return { tag: 'shot', content: fileName(event.file), detail: '', tone: 'normal' };
    case 'note':
      return markLine('note', event.text);
    case 'bug':
      return markLine('bug', event.text);
    case 'flag':
      return markLine('flag', event.text);
    case 'ingest': {
      const source = event.source ?? '-';
      const tone: EventLineTone =
        event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'normal';
      return {
        tag: 'ingest',
        content: event.message,
        detail: `${event.endpoint} · ${source}`,
        tone,
      };
    }
    case 'lifecycle':
      return { tag: 'life', content: event.state, detail: '', tone: 'muted' };
  }
}

export function formatEventLine(event: TerrificEvent): string {
  const line = describeEvent(event);
  const detail = line.detail === '' ? '' : `  ${line.detail}`;
  return `${formatOffset(event.t)}  ${line.tag.padEnd(TAG_WIDTH)}  ${line.content}${detail}`;
}
