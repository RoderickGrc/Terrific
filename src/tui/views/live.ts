import { describeEvent, type EventLine } from '../../core/event-line.ts';
import type { LifecycleState, TerrificEvent } from '../../core/events.ts';
import { formatOffset } from '../../core/format.ts';
import { type Line, line } from '../layout.ts';
import type { LiveState } from '../state.ts';
import { TAG_TONE, type Theme, type Tone } from '../theme.ts';
import { plural, type View } from './common.ts';

const LIFECYCLE_TEXT: Record<LifecycleState, string> = {
  started: 'Recording started',
  stopped: 'Recording stopped',
  interrupted: 'Recording interrupted',
  'browser-closed': 'Browser closed',
};

const BOLD_TAGS = new Set(['note', 'bug', 'flag']);

function bodyTone(described: EventLine): Tone {
  if (described.tone === 'error') return 'failure';
  if (described.tone === 'warn') return 'warn';
  if (described.tone === 'muted') return 'fg3';
  return described.tag === 'log' ? 'fg2' : 'fg1';
}

function detailText(theme: Theme, event: TerrificEvent, described: EventLine): string {
  const p = theme.paint;
  if (event.kind === 'network') {
    if (described.detail === 'pending') return p('···', 'fg3');
    if (event.status !== undefined && event.status >= 400) {
      const ms = event.durationMs === undefined ? '' : ` ${event.durationMs}ms`;
      return `${p(String(event.status), { tone: 'failure', bold: true })}${p(ms, 'fg3')}`;
    }
  }
  if (event.kind === 'ingest') {
    return `${p(event.endpoint, 'ingest')} ${p(event.source ?? '', 'fg3')}`;
  }
  if (event.kind === 'console') return '';
  return p(described.detail, 'fg3');
}

export function eventLine(theme: Theme, event: TerrificEvent, selected: boolean): Line {
  const p = theme.paint;
  const lead = selected ? p(' › ', { tone: 'accent', bold: true }) : '   ';
  const time = p(formatOffset(event.t).padEnd(9), 'fg3');
  if (event.kind === 'lifecycle') {
    return line(
      `${lead}${time}${' '.repeat(8)}${p(LIFECYCLE_TEXT[event.state], 'fg3')}`,
      '',
      selected ? 'prompt' : undefined,
    );
  }
  const described = describeEvent(event);
  const tagTone: Tone = described.tone === 'error' ? 'failure' : TAG_TONE[described.tag];
  const tag = p(described.tag.padEnd(8), { tone: tagTone, bold: BOLD_TAGS.has(described.tag) });
  const body = p(described.content, bodyTone(described));
  const detail = detailText(theme, event, described);
  return line(
    `${lead}${time}${tag}${body}`,
    detail === '' ? '' : `  ${detail}  `,
    selected ? 'prompt' : undefined,
  );
}

function kv(theme: Theme, key: string, value: string): string {
  return `${theme.paint(key.padEnd(9), 'fg2')}${theme.paint(value, 'fg1')}`;
}

export function eventDetails(theme: Theme, event: TerrificEvent, sessionId: string): string[] {
  switch (event.kind) {
    case 'network':
      return [
        kv(theme, 'request', `${event.method} ${event.url}`),
        kv(
          theme,
          'status',
          event.status === undefined ? (event.errorText ?? 'pending') : String(event.status),
        ),
        kv(theme, 'time', event.durationMs === undefined ? 'n/a' : `${event.durationMs} ms`),
        kv(
          theme,
          'bodies',
          `terrific-cli events ${sessionId} --at ${formatOffset(event.t)} --bodies`,
        ),
      ];
    case 'action': {
      const rows = [
        kv(theme, 'action', event.action),
        kv(theme, 'target', event.target.label ?? event.target.selector ?? 'element'),
      ];
      if (event.masked) rows.push(kv(theme, 'value', 'hidden, password fields are never stored'));
      return rows;
    }
    case 'ingest':
      return [
        kv(theme, 'endpoint', event.endpoint),
        kv(theme, 'source', event.source ?? '-'),
        kv(theme, 'level', event.level),
        ...(event.data === undefined ? [] : [kv(theme, 'data', JSON.stringify(event.data))]),
      ];
    case 'console':
      return [kv(theme, 'level', event.level), kv(theme, 'message', event.text)];
    case 'screenshot':
      return [kv(theme, 'file', event.file)];
    case 'navigation':
      return [kv(theme, 'url', event.url), kv(theme, 'title', event.title)];
    case 'snapshot':
      return [kv(theme, 'url', event.url), kv(theme, 'words', String(event.wordCount))];
    default:
      return [kv(theme, 'text', describeEvent(event).content)];
  }
}

/**
 * The log, scrolled to the end unless the user scrolled up or is inspecting a line. Keeps the
 * inspected line inside the window by adjusting `live.scroll`.
 */
export function liveLines(view: View, live: LiveState): Line[] {
  const { theme, state, height } = view;
  const entries = live.log.visible(state.settings.visibility);
  if (live.selected !== null && live.selected >= entries.length) live.selected = null;
  const all: Line[] = [];
  let selectedLine = -1;
  entries.forEach((entry, index) => {
    const selected = index === live.selected;
    if (selected) selectedLine = all.length;
    all.push(eventLine(theme, entry.event, selected));
    if (entry.expanded) {
      for (const detail of eventDetails(theme, entry.event, live.session.id)) {
        all.push(line(`${' '.repeat(20)}${theme.paint('│', 'fg3')} ${detail}`, '', 'prompt'));
      }
    }
  });
  if (all.length === 0) {
    return [line(`   ${theme.paint('Waiting for the first event', 'fg3')}`)];
  }
  const jump = live.scroll > 0 && live.unseen > 0;
  const room = Math.max(1, height - (jump ? 1 : 0));
  const maxScroll = Math.max(0, all.length - room);
  if (selectedLine >= 0) {
    const end = all.length - live.scroll;
    if (selectedLine >= end) live.scroll = all.length - selectedLine - 1;
    else if (selectedLine < end - room) live.scroll = all.length - selectedLine - room;
  }
  live.scroll = Math.max(0, Math.min(live.scroll, maxScroll));
  const end = all.length - live.scroll;
  const window = all.slice(Math.max(0, end - room), end);
  if (jump) {
    window.push(
      line(
        ` ${theme.paint(`↓ ${plural(live.unseen, 'new event')}`, 'info')}  ${theme.paint('End to follow', 'fg3')}`,
      ),
    );
  }
  return window;
}

export function liveStats(theme: Theme, view: View, live: LiveState): string {
  const counts = live.log.counts();
  const visibility = view.state.settings.visibility;
  const parts =
    live.session.setup.target === 'browser'
      ? [
          plural(counts.total, 'event'),
          `${counts.network} network`,
          plural(counts.actions, 'action'),
          `${counts.console} console`,
          `${counts.ingest} ingest`,
          plural(counts.notes, 'note'),
          plural(counts.bugs, 'bug'),
          plural(counts.flags, 'flag'),
          `${counts.failed} failed`,
        ]
      : [
          plural(counts.total, 'event'),
          `${counts.ingest} ingest`,
          plural(counts.notes, 'note'),
          plural(counts.bugs, 'bug'),
          plural(counts.flags, 'flag'),
        ];
  const labels: Record<keyof typeof visibility, string> = {
    action: 'actions',
    network: 'network',
    console: 'console',
    ingest: 'ingest',
  };
  const hidden = (Object.keys(labels) as (keyof typeof visibility)[])
    .filter((key) => !visibility[key])
    .map((key) => labels[key]);
  const text = theme.paint(parts.join(' · '), 'fg2');
  return hidden.length === 0
    ? text
    : `${text}${theme.paint(` · hidden: ${hidden.join(', ')}`, 'warn')}`;
}
