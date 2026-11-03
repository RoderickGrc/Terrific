import type { ProjectSettingsView } from '../core/api.ts';
import type { NetworkEvent, TerrificEvent } from '../core/events.ts';
import { isErrorEvent } from '../core/events.ts';

export type Visibility = ProjectSettingsView['visibility'];
export type VisibilityKey = keyof Visibility;

export type LogEntry = {
  event: TerrificEvent;
  expanded: boolean;
};

export type LiveCounts = {
  total: number;
  network: number;
  actions: number;
  console: number;
  ingest: number;
  notes: number;
  bugs: number;
  flags: number;
  failed: number;
  /** Failed requests, console errors and ingest errors. */
  errors: number;
};

const HIDEABLE: Partial<Record<TerrificEvent['kind'], VisibilityKey>> = {
  action: 'action',
  network: 'network',
  console: 'console',
  ingest: 'ingest',
};

/**
 * Events of one session as log lines. A request and its response share one line: the line
 * appears when the request leaves and takes the status and duration when the answer arrives.
 */
export class LiveLog {
  readonly entries: LogEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly requests = new Map<string, LogEntry>();

  /** Returns true when a new line was added (an update in place returns false). */
  add(event: TerrificEvent): boolean {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    if (event.kind === 'network') {
      const existing = this.requests.get(event.requestId);
      if (existing !== undefined && existing.event.kind === 'network') {
        existing.event = mergeNetwork(existing.event, event);
        return false;
      }
    }
    const entry: LogEntry = { event, expanded: false };
    if (event.kind === 'network') this.requests.set(event.requestId, entry);
    this.entries.push(entry);
    return true;
  }

  visible(visibility: Visibility): LogEntry[] {
    return this.entries.filter((entry) => isVisible(entry.event, visibility));
  }

  counts(): LiveCounts {
    const counts: LiveCounts = {
      total: 0,
      network: 0,
      actions: 0,
      console: 0,
      ingest: 0,
      notes: 0,
      bugs: 0,
      flags: 0,
      failed: 0,
      errors: 0,
    };
    for (const { event } of this.entries) {
      if (event.kind === 'lifecycle') continue;
      counts.total += 1;
      if (isErrorEvent(event)) counts.errors += 1;
      if (event.kind === 'network') {
        counts.network += 1;
        if (isErrorEvent(event)) counts.failed += 1;
      }
      if (event.kind === 'action') counts.actions += 1;
      if (event.kind === 'console') counts.console += 1;
      if (event.kind === 'ingest') counts.ingest += 1;
      if (event.kind === 'note') counts.notes += 1;
      if (event.kind === 'bug') counts.bugs += 1;
      if (event.kind === 'flag') counts.flags += 1;
    }
    return counts;
  }

  /** The page the browser is on: the last navigation, if any. */
  currentUrl(): string | null {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const event = this.entries[i]?.event;
      if (event?.kind === 'navigation') return event.url;
    }
    return null;
  }
}

export function isVisible(event: TerrificEvent, visibility: Visibility): boolean {
  const key = HIDEABLE[event.kind];
  return key === undefined || visibility[key];
}

function mergeNetwork(first: NetworkEvent, next: NetworkEvent): NetworkEvent {
  // The line keeps the time the request left; everything the response knows wins.
  return {
    ...first,
    ...next,
    id: first.id,
    seq: first.seq,
    at: first.at,
    t: first.t,
  };
}
