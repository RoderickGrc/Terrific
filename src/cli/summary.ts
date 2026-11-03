import type { SessionDetail } from '../core/api.ts';
import { DEFAULT_MARK_TEXT } from '../core/events.ts';
import {
  approxTokens,
  formatBytes,
  formatDuration,
  formatOffset,
  formatTokens,
  truncateMiddle,
} from '../core/format.ts';
import { formatNewCommand } from '../core/new-command.ts';
import { displayUrl } from '../core/setup.ts';
import type { SessionStats } from '../core/stats.ts';
import { formatClock } from './output.ts';

const KIND_LABELS = [
  { kind: 'network', label: 'network' },
  { kind: 'console', label: 'console' },
  { kind: 'action', label: 'actions' },
  { kind: 'navigation', label: 'navigations' },
  { kind: 'snapshot', label: 'snapshots' },
  { kind: 'screenshot', label: 'screenshots' },
  { kind: 'note', label: 'notes' },
  { kind: 'bug', label: 'bugs' },
  { kind: 'flag', label: 'flags' },
  { kind: 'ingest', label: 'ingest' },
] as const;

const FOLDER_WIDTH = 72;

function wallDurationMs(detail: SessionDetail): number {
  const start = Date.parse(detail.startedAt);
  const end = detail.stoppedAt === null ? Number.NaN : Date.parse(detail.stoppedAt);
  if (!Number.isNaN(start) && !Number.isNaN(end)) return Math.max(0, end - start);
  return detail.stats.durationMs;
}

function countLine(stats: SessionStats): string {
  const parts: string[] = [];
  for (const { kind, label } of KIND_LABELS) {
    const count = stats.counts[kind];
    if (count > 0) parts.push(`${label} ${count}`);
  }
  return parts.join(' · ');
}

function markText(kind: 'bug' | 'flag', text: string | null): string {
  return text === null || text === '' ? DEFAULT_MARK_TEXT[kind] : text;
}

function reviewLines(stats: SessionStats): string[] {
  const lines: string[] = [];
  for (const mark of stats.marks) {
    lines.push(
      `${mark.kind.padEnd(6)}  ${formatOffset(mark.t)}  ${markText(mark.kind, mark.text)}`,
    );
  }
  for (const request of stats.failedRequests) {
    const status = request.status === undefined ? 'failed' : String(request.status);
    const target = `${request.method} ${displayUrl(request.url)}`;
    lines.push(`${'net'.padEnd(6)}  ${formatOffset(request.startT)}  ${target}  ${status}`);
  }
  for (const row of stats.consoleErrors) {
    lines.push(`${'log'.padEnd(6)}  ${formatOffset(row.t)}  ${row.text}`);
  }
  for (const row of stats.ingestErrors) {
    lines.push(`${'ingest'.padEnd(6)}  ${formatOffset(row.t)}  ${row.message}`);
  }
  return lines;
}

function whereGroup(detail: SessionDetail): string | null {
  const lines: string[] = [];
  if (detail.stats.pages.length > 0) {
    lines.push(detail.stats.pages.map((page) => displayUrl(page)).join(' → '));
  }
  if (detail.endpoint !== null) {
    const ep = detail.endpoint;
    lines.push(`ingest  ${ep.name}  ${ep.state}  ${ep.url}`);
  }
  return lines.length === 0 ? null : lines.join('\n');
}

function filesGroup(detail: SessionDetail): string {
  const lines: string[] = [];
  if (detail.contextBytes === null) {
    lines.push('context  (not written)');
  } else {
    const tokens = formatTokens(approxTokens(detail.contextBytes));
    lines.push(`context  ${formatBytes(detail.contextBytes)}  ${tokens}`);
  }
  lines.push(`folder   ${truncateMiddle(detail.folder, FOLDER_WIDTH)}`);
  return lines.join('\n');
}

export function renderSummary(detail: SessionDetail): string {
  const duration = formatDuration(wallDurationMs(detail));
  const endAt = detail.stoppedAt ?? detail.startedAt;
  const clocks = `${formatClock(detail.startedAt)} to ${formatClock(endAt)}`;
  const range = `${clocks} · ${duration} · ${detail.stats.total} events`;
  const counts = countLine(detail.stats);
  const shape = counts === '' ? range : `${range}\n${counts}`;
  const review = reviewLines(detail.stats);
  const groups: string[] = [detail.verdict, shape];
  if (review.length > 0) groups.push(`To review\n${review.join('\n')}`);
  const where = whereGroup(detail);
  if (where !== null) groups.push(where);
  groups.push(filesGroup(detail));
  if (!detail.legacy) {
    groups.push(`Same setup  ${formatNewCommand(detail.setup, '')}`);
  }
  return `${groups.join('\n\n')}\n`;
}
