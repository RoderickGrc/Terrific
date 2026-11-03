import type { EventKind, TerrificEvent } from './events.ts';
import { EVENT_KINDS, isErrorEvent } from './events.ts';
import type { NetworkRequest } from './network.ts';
import { foldNetwork, isFailedRequest } from './network.ts';

export type SessionStats = {
  startT: number;
  endT: number;
  durationMs: number;
  total: number;
  counts: Record<EventKind, number>;
  failedRequests: NetworkRequest[];
  consoleErrors: { t: number; text: string }[];
  ingestErrors: { t: number; endpoint: string; message: string }[];
  pages: string[];
  marks: { t: number; kind: 'bug' | 'flag'; text: string | null }[];
  errorTimes: number[];
};

export type SessionStatsOptions = {
  initialUrl?: string;
};

function emptyCounts(): Record<EventKind, number> {
  return {
    action: 0,
    network: 0,
    console: 0,
    navigation: 0,
    snapshot: 0,
    screenshot: 0,
    note: 0,
    bug: 0,
    flag: 0,
    ingest: 0,
    lifecycle: 0,
  };
}

function addPage(pages: string[], seen: Set<string>, url: string): void {
  if (seen.has(url)) return;
  seen.add(url);
  pages.push(url);
}

export function sessionStats(
  events: readonly TerrificEvent[],
  options: SessionStatsOptions = {},
): SessionStats {
  const counts = emptyCounts();
  const folded = foldNetwork(events);
  counts.network = folded.length;

  const consoleErrors: SessionStats['consoleErrors'] = [];
  const ingestErrors: SessionStats['ingestErrors'] = [];
  const marks: SessionStats['marks'] = [];
  const errorTimes: number[] = [];
  const pages: string[] = [];
  const seenPages = new Set<string>();
  if (options.initialUrl !== undefined) addPage(pages, seenPages, options.initialUrl);

  let startT = 0;
  let endT = 0;
  let first = true;

  for (const event of events) {
    if (event.kind !== 'network') {
      counts[event.kind] += 1;
    }
    if (first) {
      startT = event.t;
      endT = event.t;
      first = false;
    } else {
      if (event.t < startT) startT = event.t;
      if (event.t > endT) endT = event.t;
    }
    if (event.kind === 'navigation') addPage(pages, seenPages, event.url);
    if (event.kind === 'console' && event.level === 'error') {
      consoleErrors.push({ t: event.t, text: event.text });
    }
    if (event.kind === 'ingest' && event.level === 'error') {
      ingestErrors.push({ t: event.t, endpoint: event.endpoint, message: event.message });
    }
    if (event.kind === 'bug' || event.kind === 'flag') {
      marks.push({ t: event.t, kind: event.kind, text: event.text });
    }
    if (isErrorEvent(event)) errorTimes.push(event.t);
  }

  let total = 0;
  for (const kind of EVENT_KINDS) {
    if (kind === 'lifecycle') continue;
    total += counts[kind];
  }

  return {
    startT,
    endT,
    durationMs: endT - startT,
    total,
    counts,
    failedRequests: folded.filter(isFailedRequest),
    consoleErrors,
    ingestErrors,
    pages,
    marks,
    errorTimes,
  };
}

export function verdictLine(stats: SessionStats): string {
  let bugs = 0;
  let flags = 0;
  for (const mark of stats.marks) {
    if (mark.kind === 'bug') bugs += 1;
    else flags += 1;
  }
  const errors =
    stats.failedRequests.length + stats.consoleErrors.length + stats.ingestErrors.length;

  const parts: string[] = [];
  if (bugs > 0) parts.push(bugs === 1 ? '1 bug to review' : `${bugs} bugs to review`);
  if (errors > 0) parts.push(errors === 1 ? '1 error' : `${errors} errors`);
  if (flags > 0) parts.push(flags === 1 ? '1 flagged' : `${flags} flagged`);
  if (parts.length === 0) return 'Nothing reported, no errors';
  return parts.join(' · ');
}
