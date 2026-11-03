import { match } from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionDetail } from '../core/api.ts';
import type { EventInput, TerrificEvent } from '../core/events.ts';
import { sessionStats, verdictLine } from '../core/stats.ts';
import { formatClock } from './output.ts';
import { renderSummary } from './summary.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}`, seq: t, at: '2026-03-01T10:00:00.000Z', t, ...input };
}

const events: TerrificEvent[] = [
  event({ kind: 'lifecycle', state: 'started' }, 0),
  event({ kind: 'navigation', url: 'http://localhost:5173/', title: 'Home' }, 100),
  event({ kind: 'navigation', url: 'http://localhost:5173/today', title: 'Today' }, 200),
  event(
    {
      kind: 'action',
      action: 'click',
      target: { label: 'Save' },
      masked: false,
    },
    1000,
  ),
  event(
    {
      kind: 'network',
      phase: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'http://localhost:5173/api/missing',
      status: 404,
      durationMs: 12,
    },
    2000,
  ),
  event({ kind: 'console', level: 'error', text: 'boom' }, 2500),
  event({ kind: 'bug', text: 'broken form', author: 'agent' }, 192400),
  event({ kind: 'flag', text: null, author: 'agent' }, 193000),
  event({ kind: 'lifecycle', state: 'stopped' }, 200000),
];

const stats = sessionStats(events, { initialUrl: 'http://localhost:5173/' });

const detail: SessionDetail = {
  id: 'ab12cd34ef',
  name: 'login check',
  status: 'stopped',
  startedAt: '2026-03-01T10:00:00.000Z',
  stoppedAt: '2026-03-01T10:03:20.000Z',
  projectId: 'k2m8q4zx',
  projectPath: 'D:\\work\\demo-app',
  setup: {
    target: 'browser',
    url: 'http://localhost:5173/',
    profile: 'clean',
    record: { actions: true, network: true, console: true },
    endpoint: 'app',
  },
  endpoint: {
    name: 'app',
    url: 'http://127.0.0.1:4569/ingest/ing_exampletoken0000000001',
    state: 'open',
    closedReason: null,
    createdAt: '2026-03-01T09:00:00.000Z',
    lastEventAt: '2026-03-01T10:03:00.000Z',
    eventCount: 1,
  },
  legacy: false,
  folder: 'D:\\work\\demo-app\\.terrific\\sessions\\2026-03-01_10-00-00_ab12cd34ef',
  files: {
    context: 'D:\\work\\demo-app\\.terrific\\sessions\\2026-03-01_10-00-00_ab12cd34ef\\context.txt',
    events: 'D:\\work\\demo-app\\.terrific\\sessions\\2026-03-01_10-00-00_ab12cd34ef\\events.jsonl',
    screenshots:
      'D:\\work\\demo-app\\.terrific\\sessions\\2026-03-01_10-00-00_ab12cd34ef\\screenshots',
  },
  stats,
  verdict: verdictLine(stats),
  contextBytes: 14400,
};

test('renderSummary prints the grouped stop/show text', () => {
  const text = renderSummary(detail);
  const start = formatClock(detail.startedAt);
  const end = formatClock(detail.stoppedAt ?? detail.startedAt);
  match(text, /^1 bug to review · 2 errors · 1 flagged\n\n/);
  match(text, new RegExp(`${start} to ${end} · 3m 20s · 7 events`));
  match(text, /network 1 · console 1 · actions 1 · navigations 2 · bugs 1 · flags 1/);
  match(text, /\n\nTo review\n/);
  match(text, /bug {5}03:12\.4 {2}broken form/);
  match(text, /flag {4}03:13\.0 {2}Flagged point of interest/);
  match(text, /net {5}00:02\.0 {2}GET localhost:5173\/api\/missing {2}404/);
  match(text, /log {5}00:02\.5 {2}boom/);
  match(text, /localhost:5173\/ → localhost:5173\/today/);
  match(
    text,
    /ingest {2}app {2}open {2}http:\/\/127\.0\.0\.1:4569\/ingest\/ing_exampletoken0000000001/,
  );
  match(text, /context {2}14\.1 KB {2}~3\.6k tokens/);
  match(text, /folder {3}/);
  match(text, /Same setup {2}\/new localhost:5173\/ @clean #app\n$/);
});

test('renderSummary omits To review and Same setup when they do not apply', () => {
  const emptyStats = sessionStats([]);
  const legacy: SessionDetail = {
    ...detail,
    name: null,
    legacy: true,
    endpoint: null,
    contextBytes: null,
    stats: emptyStats,
    verdict: verdictLine(emptyStats),
  };
  const text = renderSummary(legacy);
  match(text, /^Nothing reported, no errors\n/);
  if (text.includes('To review')) throw new Error('expected empty review to be omitted');
  if (text.includes('Same setup')) throw new Error('expected legacy sessions to omit Same setup');
  match(text, /context {2}\(not written\)/);
});
