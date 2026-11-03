import { deepEqual, equal, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { TerrificError } from './errors.ts';
import { parseEventQuery, queryEvents } from './event-query.ts';
import type { EventInput, TerrificEvent } from './events.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}_${input.kind}`, seq: t, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

test('parseEventQuery reads documented query keys', () => {
  const query = parseEventQuery(params('type=bug,flag&around=01:02&window=500ms&bodies=1&limit=3'));
  deepEqual(query.types, ['bug', 'flag']);
  equal(query.around, 62_000);
  equal(query.window, 500);
  equal(query.bodies, true);
  equal(query.limit, 3);
});

test('parseEventQuery window units and at implying bodies', () => {
  equal(parseEventQuery(params('window=10s')).window, 10_000);
  equal(parseEventQuery(params('window=2m')).window, 120_000);
  const at = parseEventQuery(params('at=00:05'));
  equal(at.at, 5_000);
  equal(at.bodies, true);
});

test('parseEventQuery names the offending parameter', () => {
  throws(
    () => parseEventQuery(params('window=abc')),
    (error: unknown) =>
      error instanceof TerrificError && error.code === 'USAGE' && error.message.includes('window'),
  );
  throws(
    () => parseEventQuery(params('type=nope')),
    (error: unknown) => error instanceof TerrificError && error.message.includes('type'),
  );
  throws(
    () => parseEventQuery(params('around=nope')),
    (error: unknown) => error instanceof TerrificError && error.message.includes('around'),
  );
  throws(
    () => parseEventQuery(params('limit=-1')),
    (error: unknown) => error instanceof TerrificError && error.message.includes('limit'),
  );
});

test('queryEvents filters types, around, at, strips bodies, and limits from the end', () => {
  const events = [
    event({ kind: 'note', text: 'n', author: 'tester' }, 0),
    event(
      {
        kind: 'network',
        phase: 'response',
        requestId: 'r1',
        method: 'GET',
        url: 'https://x.test',
        status: 500,
        requestBody: 'req',
        responseBody: 'res',
      },
      1_000,
    ),
    event({ kind: 'bug', text: null, author: 'tester' }, 5_000),
    event({ kind: 'flag', text: 'here', author: 'tester' }, 8_000),
    event(
      {
        kind: 'snapshot',
        url: 'https://x.test',
        title: 'X',
        wordCount: 4,
        markdown: '# huge',
      },
      9_000,
    ),
    event({ kind: 'ingest', endpoint: 'app', message: 'boom', level: 'error' }, 12_000),
  ];

  const marks = queryEvents(events, { types: ['bug', 'flag'] });
  equal(marks.length, 2);
  equal(marks[0]?.kind, 'bug');
  equal(marks[1]?.kind, 'flag');

  const around = queryEvents(events, { around: 5_000, window: 2_000 });
  equal(around.length, 1);
  equal(around[0]?.kind, 'bug');

  const errors = queryEvents(events, { types: ['errors'] });
  equal(errors.length, 2);
  equal(errors[0]?.kind, 'network');
  equal(errors[1]?.kind, 'ingest');

  const stripped = queryEvents(events, { types: ['network', 'snapshot'] });
  const net = stripped[0];
  const snap = stripped[1];
  if (net === undefined || net.kind !== 'network') throw new Error('expected network');
  if (snap === undefined || snap.kind !== 'snapshot') throw new Error('expected snapshot');
  equal(Object.hasOwn(net, 'requestBody'), false);
  equal(Object.hasOwn(net, 'responseBody'), false);
  equal(snap.markdown, '');
  equal(snap.wordCount, 4);

  const kept = queryEvents(events, { types: ['network'], bodies: true });
  const full = kept[0];
  if (full === undefined || full.kind !== 'network') throw new Error('expected network');
  equal(full.requestBody, 'req');

  const last = queryEvents(events, { limit: 2 });
  equal(last.length, 2);
  equal(last[0]?.kind, 'snapshot');
  equal(last[1]?.kind, 'ingest');

  const at = queryEvents(events, { at: 5_000 });
  equal(at.length, 1);
  equal(at[0]?.kind, 'bug');
});
