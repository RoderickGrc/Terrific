import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { EventInput, TerrificEvent } from './events.ts';
import { EVENT_KINDS } from './events.ts';
import { sessionStats, verdictLine } from './stats.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}`, seq: t, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

test('sessionStats on an empty list is zeros and empty arrays', () => {
  const stats = sessionStats([]);
  equal(stats.startT, 0);
  equal(stats.endT, 0);
  equal(stats.durationMs, 0);
  equal(stats.total, 0);
  for (const kind of EVENT_KINDS) {
    equal(stats.counts[kind], 0);
  }
  deepEqual(stats.failedRequests, []);
  deepEqual(stats.consoleErrors, []);
  deepEqual(stats.ingestErrors, []);
  deepEqual(stats.pages, []);
  deepEqual(stats.marks, []);
  deepEqual(stats.errorTimes, []);
});

test('sessionStats folds network, excludes lifecycle from total, and orders pages', () => {
  const stats = sessionStats(
    [
      event({ kind: 'lifecycle', state: 'started' }, 0),
      event(
        {
          kind: 'network',
          phase: 'request',
          requestId: 'a',
          method: 'GET',
          url: 'https://a.test/x',
        },
        5,
      ),
      event({ kind: 'navigation', url: 'https://a.test/x', title: 'X' }, 6),
      event({ kind: 'navigation', url: 'https://a.test/y', title: 'Y' }, 8),
      event({ kind: 'navigation', url: 'https://a.test/x', title: 'X again' }, 9),
      event(
        {
          kind: 'network',
          phase: 'response',
          requestId: 'a',
          method: 'GET',
          url: 'https://a.test/x',
          status: 404,
          durationMs: 10,
        },
        15,
      ),
      event({ kind: 'console', level: 'error', text: 'boom' }, 16),
      event(
        {
          kind: 'ingest',
          endpoint: 'app',
          message: 'down',
          level: 'error',
        },
        17,
      ),
      event({ kind: 'bug', text: 'broken', author: 'tester' }, 18),
      event({ kind: 'flag', text: null, author: 'tester' }, 19),
      event({ kind: 'lifecycle', state: 'stopped' }, 20),
    ],
    { initialUrl: 'https://a.test/x' },
  );

  equal(stats.startT, 0);
  equal(stats.endT, 20);
  equal(stats.durationMs, 20);
  equal(stats.counts.network, 1);
  equal(stats.counts.lifecycle, 2);
  equal(stats.counts.navigation, 3);
  equal(stats.total, 8);
  equal(stats.failedRequests.length, 1);
  deepEqual(stats.consoleErrors, [{ t: 16, text: 'boom' }]);
  deepEqual(stats.ingestErrors, [{ t: 17, endpoint: 'app', message: 'down' }]);
  deepEqual(stats.pages, ['https://a.test/x', 'https://a.test/y']);
  deepEqual(stats.marks, [
    { t: 18, kind: 'bug', text: 'broken' },
    { t: 19, kind: 'flag', text: null },
  ]);
  deepEqual(stats.errorTimes, [15, 16, 17]);
});

test('sessionStats counts a typed start URL and the page it loads as one page', () => {
  const navigation = { id: 'n', seq: 1, at: '', t: 1, kind: 'navigation', url: 'https://a.test/' };
  const stats = sessionStats([navigation as TerrificEvent], { initialUrl: 'https://a.test' });
  deepEqual(stats.pages, ['https://a.test']);
});

test('verdictLine uses singular, plural, and omits zero parts', () => {
  const empty = sessionStats([]);
  equal(verdictLine(empty), 'Nothing reported, no errors');

  const rows: { bugs: number; flags: number; errors: number; line: string }[] = [
    { bugs: 1, flags: 0, errors: 0, line: '1 bug to review' },
    { bugs: 2, flags: 1, errors: 1, line: '2 bugs to review · 1 error · 1 flagged' },
    { bugs: 0, flags: 2, errors: 3, line: '3 errors · 2 flagged' },
    { bugs: 0, flags: 1, errors: 0, line: '1 flagged' },
  ];

  for (const row of rows) {
    const stats = sessionStats([]);
    for (let i = 0; i < row.bugs; i += 1) {
      stats.marks.push({ t: i, kind: 'bug', text: null });
    }
    for (let i = 0; i < row.flags; i += 1) {
      stats.marks.push({ t: i, kind: 'flag', text: null });
    }
    for (let i = 0; i < row.errors; i += 1) {
      stats.consoleErrors.push({ t: i, text: 'e' });
    }
    equal(verdictLine(stats), row.line);
  }
});
