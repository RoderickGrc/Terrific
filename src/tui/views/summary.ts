import type { SessionDetail } from '../../core/api.ts';
import { DEFAULT_MARK_TEXT, type EventKind } from '../../core/events.ts';
import {
  approxTokens,
  formatBytes,
  formatDuration,
  formatOffset,
  formatTokens,
} from '../../core/format.ts';
import { formatNewCommand } from '../../core/new-command.ts';
import { displayUrl } from '../../core/setup.ts';
import { clock, dateTime, parseTime, timeOfDay } from '../format.ts';
import { blank, type Line, line, trimPathMiddle, wrapItems } from '../layout.ts';
import type { SummaryState } from '../state.ts';
import type { Theme, Tone } from '../theme.ts';
import { keyHint, plural, sep, type View } from './common.ts';

const SHOWN_ERRORS = 4;
const SHOWN_PAGES = 4;
const LABEL_WIDTH = 11;

const COUNT_KINDS: { kind: EventKind; one: string; many: string; tone: Tone }[] = [
  { kind: 'network', one: 'network', many: 'network', tone: 'net' },
  { kind: 'action', one: 'action', many: 'actions', tone: 'act' },
  { kind: 'console', one: 'console', many: 'console', tone: 'log' },
  { kind: 'ingest', one: 'ingest', many: 'ingest', tone: 'ingest' },
  { kind: 'navigation', one: 'page load', many: 'page loads', tone: 'nav' },
  { kind: 'screenshot', one: 'screenshot', many: 'screenshots', tone: 'capture' },
  { kind: 'snapshot', one: 'snapshot', many: 'snapshots', tone: 'capture' },
  { kind: 'note', one: 'note', many: 'notes', tone: 'note' },
  { kind: 'bug', one: 'bug', many: 'bugs', tone: 'bug' },
  { kind: 'flag', one: 'flag', many: 'flags', tone: 'flag' },
];

export function wallDuration(detail: SessionDetail): number {
  const start = parseTime(detail.startedAt);
  const end = parseTime(detail.stoppedAt);
  return start !== null && end !== null ? Math.max(0, end - start) : detail.stats.durationMs;
}

/** The session's duration as a line, with bugs, flags and timed errors where they happened. */
export function markRail(
  theme: Theme,
  durationMs: number,
  width: number,
  marks: { t: number; kind: 'bug' | 'flag' }[],
  errorTimes: number[] = [],
): string {
  const span = Math.max(1, durationMs);
  const cells: ('bug' | 'flag' | 'err' | null)[] = Array.from({ length: width }, () => null);
  const rank = { bug: 3, err: 2, flag: 1 } as const;
  const put = (t: number, kind: 'bug' | 'flag' | 'err'): void => {
    const i = Math.min(width - 1, Math.max(0, Math.floor((t / span) * width)));
    const current = cells[i];
    if (current === null || current === undefined || rank[kind] > rank[current]) cells[i] = kind;
  };
  for (const mark of marks) put(mark.t, mark.kind);
  for (const t of errorTimes) put(t, 'err');
  return cells
    .map((cell) => {
      if (cell === 'bug') return theme.paint('●', { tone: 'bug', bold: true });
      if (cell === 'flag') return theme.paint('◆', { tone: 'flag', bold: true });
      if (cell === 'err') return theme.paint('✕', { tone: 'failure', bold: true });
      return theme.paint('─', 'fg3');
    })
    .join('');
}

function eventBar(theme: Theme, detail: SessionDetail, width: number): string {
  const items = COUNT_KINDS.map((k) => ({ ...k, n: detail.stats.counts[k.kind] })).filter(
    (k) => k.n > 0,
  );
  const total = items.reduce((sum, k) => sum + k.n, 0);
  if (total === 0) return theme.paint('─'.repeat(width), 'fg3');
  const cells = items.map((k) => ({
    tone: k.tone,
    n: Math.max(1, Math.round((k.n / total) * width)),
  }));
  let used = cells.reduce((sum, c) => sum + c.n, 0);
  const biggest = (): { n: number } => cells.reduce((max, c) => (c.n > max.n ? c : max));
  while (used > width) {
    biggest().n -= 1;
    used -= 1;
  }
  if (used < width) biggest().n += width - used;
  return cells.map((c) => theme.paint('█'.repeat(c.n), c.tone)).join('');
}

export function summaryLines(view: View, summary: SummaryState): Line[] {
  const { theme, width } = view;
  const p = theme.paint;
  const d = summary.detail;
  const stats = d.stats;
  const label = (name: string, value: string): Line =>
    line(`   ${p(name.padEnd(LABEL_WIDTH), 'fg2')}${value}`);
  const cont = (value: string): Line => line(`   ${' '.repeat(LABEL_WIDTH)}${value}`);
  const out: Line[] = [blank()];

  // 1. The answer first.
  const bugs = stats.marks.filter((m) => m.kind === 'bug').length;
  const flags = stats.marks.length - bugs;
  const errors = [
    ...stats.failedRequests.map((r) => ({
      t: r.startT,
      kind: 'failed',
      text: `${r.method} ${displayUrl(r.url)}  ${r.status ?? r.errorText ?? 'failed'}`,
    })),
    ...stats.consoleErrors.map((e) => ({ t: e.t, kind: 'error', text: e.text })),
    ...stats.ingestErrors.map((e) => ({
      t: e.t,
      kind: 'ingest',
      text: `${e.endpoint}  ${e.message}`,
    })),
  ].sort((a, b) => a.t - b.t);
  const verdict: string[] = [];
  if (bugs > 0) verdict.push(p(`${plural(bugs, 'bug')} to review`, { tone: 'bug', bold: true }));
  if (errors.length > 0)
    verdict.push(p(plural(errors.length, 'error'), { tone: 'failure', bold: true }));
  if (flags > 0) verdict.push(p(`${flags} flagged`, { tone: 'flag', bold: true }));
  const dot =
    bugs > 0
      ? p('●', { tone: 'bug', bold: true })
      : errors.length > 0
        ? p('✕', { tone: 'failure', bold: true })
        : flags > 0
          ? p('◆', { tone: 'flag', bold: true })
          : p('✓', { tone: 'ok', bold: true });
  const answer =
    verdict.length === 0
      ? p('Nothing reported, no errors', { tone: 'fg1', bold: true })
      : verdict.join(sep(theme)) + (errors.length > 0 ? '' : p('  ·  no errors', 'fg2'));
  out.push(line(`   ${dot} ${answer}`));
  const duration = wallDuration(d);
  const start = parseTime(d.startedAt) ?? 0;
  const end = start + duration;
  const range =
    new Date(start).toDateString() === new Date(end).toDateString()
      ? `${dateTime(start, true)} → ${timeOfDay(end)}`
      : `${dateTime(start, true)} → ${dateTime(end, true)}`;
  out.push(
    line(
      `     ${p(range, 'fg2')}${sep(theme)}${p(formatDuration(duration), 'fg1')}${sep(theme)}${p(plural(stats.total, 'event'), 'fg1')}`,
    ),
    blank(),
  );

  // 2. The shape of the session.
  const railWidth = Math.max(20, Math.min(60, width - 34));
  out.push(
    label(
      'Timeline',
      `${p('00:00 ', 'fg3')}${markRail(theme, duration, railWidth, stats.marks, stats.errorTimes)}${p(` ${clock(duration)}`, 'fg3')}`,
    ),
    label('Events', `${' '.repeat(6)}${eventBar(theme, d, railWidth)}`),
  );
  const legend = COUNT_KINDS.filter((k) => stats.counts[k.kind] > 0).map((k) => {
    const n = stats.counts[k.kind];
    const word = n === 1 ? k.one : k.many;
    return { text: `${n} ${word}`, styled: `${p(String(n), 'fg1')} ${p(word, k.tone)}` };
  });
  for (const row of wrapItems(legend, Math.max(20, width - 24), {
    text: ' · ',
    styled: p(' · ', 'fg3'),
  })) {
    out.push(cont(`${' '.repeat(6)}${row}`));
  }

  // 3. What to look at.
  if (stats.marks.length > 0 || errors.length > 0) {
    out.push(blank());
    let first = true;
    const push = (value: string): void => {
      out.push(first ? label('To review', value) : cont(value));
      first = false;
    };
    for (const mark of stats.marks) {
      const empty = mark.text === null || mark.text === '';
      const text = empty ? DEFAULT_MARK_TEXT[mark.kind] : (mark.text ?? '');
      push(
        `${p(formatOffset(mark.t), 'fg3')}  ${p(mark.kind.padEnd(6), { tone: mark.kind, bold: true })}${p(text, empty ? 'fg3' : 'fg1')}`,
      );
    }
    for (const error of errors.slice(0, SHOWN_ERRORS)) {
      push(
        `${p(formatOffset(error.t), 'fg3')}  ${p(error.kind.padEnd(8), { tone: 'failure', bold: true })}${p(error.text, 'failure')}`,
      );
    }
    if (errors.length > SHOWN_ERRORS)
      push(p(`+${errors.length - SHOWN_ERRORS} more errors`, 'fg3'));
  }

  // 4. Where it went.
  const pages = d.setup.target === 'browser' ? stats.pages : [];
  if (pages.length > 0 || d.endpoint !== null) {
    out.push(blank());
    if (pages.length > 0) {
      const path = pages
        .slice(0, SHOWN_PAGES)
        .map((page) => p(displayUrl(page), 'nav'))
        .join(p('  →  ', 'fg3'));
      const more = pages.length > SHOWN_PAGES ? p(`  +${pages.length - SHOWN_PAGES}`, 'fg3') : '';
      out.push(label('Pages', path + more));
    }
    if (d.endpoint !== null) {
      const state = d.endpoint.state === 'open' ? 'still open' : 'closed';
      out.push(label('Ingest', `${p(d.endpoint.name, 'ingest')} ${p(state, 'fg3')}`));
    }
  }

  // 5. Files.
  out.push(blank());
  out.push(
    label(
      'Context',
      d.contextBytes === null
        ? p('not written yet', 'fg3')
        : `${p(formatBytes(d.contextBytes), 'fg1')}  ${p(formatTokens(approxTokens(d.contextBytes)), 'fg3')}`,
    ),
    label(
      'Saved in',
      `${p(trimPathMiddle(d.folder, Math.max(20, width - 20)), 'fg3')}${d.legacy ? `  ${p('legacy, read only', 'fg3')}` : ''}`,
    ),
    blank(),
    line(
      `   ${keyHint(theme, '/copy', 'for an agent')}   ${keyHint(theme, '/export', 'write context file')}   ${keyHint(theme, '/new', 'another session')}`,
    ),
  );

  for (const block of summary.blocks) {
    out.push(
      blank(),
      line(`   ${p(block.title, { tone: block.ok ? 'ok' : 'err', bold: true })}`),
      blank('prompt'),
    );
    for (const text of block.lines) out.push(line(`     ${p(text, 'fg2')}`, '', 'prompt'));
    out.push(blank('prompt'));
  }
  return out;
}

export function sameSetup(detail: SessionDetail): string {
  if (detail.legacy) return 'Legacy session, read in place';
  return `Same setup: ${formatNewCommand(detail.setup, detail.name ?? '')}`;
}
