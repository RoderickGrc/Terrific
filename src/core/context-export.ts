import { encode } from '@toon-format/toon';
import {
  collapseViteReloadNoise,
  debounceInputEvents,
  filterStaticResources,
} from './context-heuristics.ts';
import { eventsToRows } from './context-rows.ts';
import type { TerrificEvent } from './events.ts';
import { isErrorEvent } from './events.ts';
import { foldNetwork, isFailedRequest } from './network.ts';
import type { SessionSummaryInfo } from './session.ts';

export type ContextOnly = 'bug' | 'flag' | 'note' | 'errors';

export type ContextInput = {
  session: SessionSummaryInfo;
  events: readonly TerrificEvent[];
  only?: ContextOnly[];
};

export function contextFileName(): string {
  return 'context.txt';
}

function onOff(value: boolean): 'on' | 'off' {
  return value ? 'on' : 'off';
}

// Record options only apply to a browser; listing them for a session without one would mislead.
function recordedLine(session: SessionSummaryInfo): string {
  const ingest = `ingest ${session.setup.endpoint ?? 'none'}`;
  if (session.setup.target === 'none') return `no browser, ${ingest}`;
  const { actions, network, console } = session.setup.record;
  return `actions ${onOff(actions)}, network ${onOff(network)}, console ${onOff(console)}, ${ingest}`;
}

function initialUrlLine(session: SessionSummaryInfo): string {
  if (session.setup.target === 'none') return 'No browser';
  if (session.setup.url === '') return 'Empty tab';
  return session.setup.url;
}

export function applyOnlyFilter(
  events: readonly TerrificEvent[],
  only: readonly ContextOnly[] | undefined,
): TerrificEvent[] {
  if (only === undefined || only.length === 0) return [...events];
  const wanted = new Set(only);
  const failedIds = new Set(
    foldNetwork(events)
      .filter(isFailedRequest)
      .map((request) => request.requestId),
  );
  return events.filter((event) => {
    if (event.kind === 'bug' && wanted.has('bug')) return true;
    if (event.kind === 'flag' && wanted.has('flag')) return true;
    if (event.kind === 'note' && wanted.has('note')) return true;
    if (wanted.has('errors')) {
      if (isErrorEvent(event)) return true;
      return event.kind === 'network' && failedIds.has(event.requestId);
    }
    return false;
  });
}

function filterLine(only: readonly ContextOnly[] | undefined): string {
  if (only === undefined || only.length === 0) return 'All events';
  return `Only: ${only.join(', ')}`;
}

export function renderContext(input: ContextInput): string {
  const { session, events, only } = input;
  const filtered = applyOnlyFilter(events, only);
  const debounced = debounceInputEvents(filtered);
  const withoutStatic = filterStaticResources(debounced);
  const collapsed = collapseViteReloadNoise(withoutStatic);
  const rows = eventsToRows(collapsed);
  const toon = encode({ events: rows });
  const header = [
    '=== CONTEXT ===',
    `ID: ${session.id}`,
    `Name: ${session.name ?? 'N/A'}`,
    `Status: ${session.status}`,
    `Date: ${session.startedAt}`,
    `Initial URL: ${initialUrlLine(session)}`,
    `Recorded: ${recordedLine(session)}`,
    `Export filters: ${filterLine(only)}`,
    `Events exported: ${rows.length} of ${events.length}`,
  ];
  return [...header, '', '=== EVENT LOG ===', toon, '', '=== END OF EXPORT ===', ''].join('\n');
}
