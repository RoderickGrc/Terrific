import { actionLine } from './context-rows.ts';
import type { EventKind, TerrificEvent } from './events.ts';
import { DEFAULT_MARK_TEXT } from './events.ts';
import {
  approxTokens,
  formatBytes,
  formatDuration,
  formatOffset,
  formatTokens,
  pluralize,
} from './format.ts';
import { redactUrl } from './redaction.ts';
import type { SessionSummaryInfo } from './session.ts';
import { displayUrl } from './setup.ts';
import { sessionStats, verdictLine } from './stats.ts';

export type CopyEndpoint = { name: string; url: string; state: 'open' | 'closed' };

export type CopyInput = {
  session: SessionSummaryInfo;
  events: readonly TerrificEvent[];
  projectId: string;
  files: {
    folder: string;
    context: string;
    events: string;
    screenshots: string;
    contextBytes: number | null;
  };
  endpoint: CopyEndpoint | null;
};

const COUNT_WORDS: { kind: EventKind; one: string; many: string }[] = [
  { kind: 'action', one: 'action', many: 'actions' },
  { kind: 'network', one: 'network', many: 'network' },
  { kind: 'console', one: 'console', many: 'console' },
  { kind: 'navigation', one: 'page load', many: 'page loads' },
  { kind: 'snapshot', one: 'snapshot', many: 'snapshots' },
  { kind: 'screenshot', one: 'screenshot', many: 'screenshots' },
  { kind: 'note', one: 'note', many: 'notes' },
  { kind: 'bug', one: 'bug', many: 'bugs' },
  { kind: 'flag', one: 'flag', many: 'flags' },
  { kind: 'ingest', one: 'ingest', many: 'ingest' },
];

function sessionTitle(session: SessionSummaryInfo): string {
  return session.name ? ` "${session.name}"` : '';
}

function countsText(stats: ReturnType<typeof sessionStats>): string {
  const parts: string[] = [];
  for (const { kind, one, many } of COUNT_WORDS) {
    const count = stats.counts[kind];
    if (count > 0) parts.push(pluralize(count, one, many));
  }
  return parts.join(', ') || 'none';
}

function rangeDurationMs(session: SessionSummaryInfo, fallback: number): number {
  if (session.stoppedAt === null) return fallback;
  const start = Date.parse(session.startedAt);
  const stop = Date.parse(session.stoppedAt);
  if (Number.isNaN(start) || Number.isNaN(stop)) return fallback;
  return Math.max(0, stop - start);
}

function targetPhrase(session: SessionSummaryInfo): string {
  if (session.setup.target === 'none') return 'without a browser';
  if (session.setup.url === '') return 'browser started on an empty tab';
  return `starting at ${displayUrl(session.setup.url)}`;
}

function markText(kind: 'bug' | 'flag', text: string | null): string {
  return text ?? DEFAULT_MARK_TEXT[kind];
}

function aroundStamp(ms: number): string {
  const offset = formatOffset(ms);
  const dot = offset.lastIndexOf('.');
  return dot === -1 ? offset : offset.slice(0, dot);
}

function contextSize(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return `${formatBytes(bytes)}, ${formatTokens(approxTokens(bytes))}`;
}

function plainEvent(event: TerrificEvent): string {
  switch (event.kind) {
    case 'network': {
      const status = event.status === undefined ? '' : ` ${event.status}`;
      return `${event.method} ${redactUrl(event.url)}${status}`;
    }
    case 'action':
      return actionLine(event);
    case 'console':
      return `console ${event.level}: ${event.text}`;
    case 'navigation':
      return `page load ${redactUrl(event.url)}`;
    case 'ingest': {
      const source = event.source ? ` ${event.source}` : '';
      return `ingest ${event.endpoint} ${event.level}${source}: ${event.message}`;
    }
    case 'screenshot':
      return 'screenshot';
    case 'snapshot':
      return 'page snapshot';
    case 'note':
      return event.text;
    case 'bug':
    case 'flag':
      return markText(event.kind, event.text);
    case 'lifecycle':
      return event.state;
  }
}

function precedingLines(events: readonly TerrificEvent[], markT: number): string[] {
  const windowed = events.filter(
    (event) =>
      event.t < markT &&
      event.t >= markT - 10_000 &&
      event.kind !== 'note' &&
      event.kind !== 'bug' &&
      event.kind !== 'flag' &&
      event.kind !== 'lifecycle',
  );
  return windowed.slice(-5).map((event) => `  ${formatOffset(event.t)}  ${plainEvent(event)}`);
}

export function agentPrompt(input: CopyInput): string {
  const { session, events, projectId, files, endpoint } = input;
  const stats = sessionStats(events, {
    initialUrl: session.setup.url === '' ? undefined : session.setup.url,
  });
  const duration = formatDuration(rangeDurationMs(session, stats.durationMs));
  const stopped = session.stoppedAt ?? 'still recording';
  const lines = [
    `Terrific QA session ${session.id}${sessionTitle(session)}`,
    `Project: ${session.projectPath} (id ${projectId})`,
    `Recorded ${session.startedAt} to ${stopped} (${duration}), ${targetPhrase(session)}`,
  ];
  if (endpoint !== null) {
    const state = endpoint.state === 'open' ? 'still open' : 'closed';
    lines.push(`Ingest endpoint "${endpoint.name}": ${endpoint.url} (${state})`);
  }
  lines.push(`${stats.total} events: ${countsText(stats)}. ${verdictLine(stats)}`);
  // Marks come from the events because only they say who made each one: the tester or an agent.
  const marks = events.filter((event) => event.kind === 'bug' || event.kind === 'flag');
  if (marks.length > 0) {
    lines.push('', 'Bugs and flags:');
    for (const mark of marks) {
      const by = mark.author === 'agent' ? ' (marked by an agent)' : '';
      lines.push(
        `- ${mark.kind} at ${formatOffset(mark.t)}${by}: ${markText(mark.kind, mark.text)}`,
      );
    }
  }
  if (stats.failedRequests.length > 0) {
    lines.push('', 'Failed requests:');
    for (const request of stats.failedRequests.slice(0, 8)) {
      const status = request.status === undefined ? '' : ` ${request.status}`;
      lines.push(`- ${request.method} ${redactUrl(request.url)}${status}`);
    }
  }
  // The verdict counts these errors too, so the prompt lists them instead of leaving a bare count.
  const errors = [
    ...stats.consoleErrors.map((row) => ({ t: row.t, text: `console: ${row.text}` })),
    ...stats.ingestErrors.map((row) => ({ t: row.t, text: `${row.endpoint}: ${row.message}` })),
  ].sort((a, b) => a.t - b.t);
  if (errors.length > 0) {
    lines.push('', 'Errors:');
    for (const row of errors.slice(0, 8)) {
      lines.push(`- ${formatOffset(row.t)} ${row.text}`);
    }
  }
  lines.push('', 'Files:');
  lines.push(`- Context, read this first: ${files.context} (${contextSize(files.contextBytes)})`);
  lines.push(`- Raw events: ${files.events}`);
  if (stats.counts.screenshot > 0) {
    lines.push(
      `- Screenshots: ${pluralize(stats.counts.screenshot, 'PNG file')} in ${files.screenshots}`,
    );
  }
  lines.push('', 'Targeted reads:');
  lines.push(`  terrific events ${session.id} --type bug,flag,note`);
  const firstMark = stats.marks[0];
  if (firstMark !== undefined) {
    lines.push(`  terrific events ${session.id} --around ${aroundStamp(firstMark.t)} --window 10s`);
  }
  return lines.join('\n');
}

export function bugsAndErrors(input: CopyInput): string {
  const { session, events, files } = input;
  const stats = sessionStats(events);
  const lines = [`Bugs and errors in Terrific session ${session.id}${sessionTitle(session)}`, ''];
  const nothing =
    stats.marks.length === 0 &&
    stats.failedRequests.length === 0 &&
    stats.consoleErrors.length === 0 &&
    stats.ingestErrors.length === 0;
  if (nothing) lines.push('Nothing reported and no errors captured.');
  for (const mark of stats.marks) {
    lines.push(
      `${mark.kind.toUpperCase()} at ${formatOffset(mark.t)}: ${markText(mark.kind, mark.text)}`,
    );
    lines.push(...precedingLines(events, mark.t));
    lines.push('');
  }
  for (const request of stats.failedRequests) {
    const status = request.status === undefined ? '' : ` ${request.status}`;
    const err = request.errorText === undefined ? '' : ` ${request.errorText}`;
    lines.push(`FAILED ${request.method} ${redactUrl(request.url)}${status}${err}`);
  }
  for (const row of stats.consoleErrors) lines.push(`ERROR ${row.text}`);
  for (const row of stats.ingestErrors) lines.push(`ERROR ${row.endpoint}: ${row.message}`);
  lines.push('', `Full context: ${files.context}`);
  return lines.join('\n');
}

export function endpointInstructions(endpoint: CopyEndpoint): string {
  return [
    `Terrific ingest endpoint "${endpoint.name}" (${endpoint.state})`,
    `POST ${endpoint.url}`,
    '',
    'JSON body: message (required), source, diagnosticSlug, level (debug, info, warn, error), timestamp, data',
    '',
    'Example:',
    `curl -X POST '${endpoint.url}' -H 'Content-Type: application/json' -d '{"message":"hello from my app","source":"server.ts:12"}'`,
  ].join('\n');
}
