import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { EventInput, TerrificEvent } from './events.ts';
import { foldNetwork, isFailedRequest } from './network.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}`, seq: t, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

test('foldNetwork pairs records by requestId and keeps request order', () => {
  const folded = foldNetwork([
    event({ kind: 'console', level: 'log', text: 'skip' }, 1),
    event(
      {
        kind: 'network',
        phase: 'request',
        requestId: 'a',
        method: 'GET',
        url: 'https://a.test',
      },
      10,
    ),
    event(
      {
        kind: 'network',
        phase: 'request',
        requestId: 'b',
        method: 'POST',
        url: 'https://b.test',
        requestBody: '{}',
      },
      11,
    ),
    event(
      {
        kind: 'network',
        phase: 'response',
        requestId: 'a',
        method: 'GET',
        url: 'https://a.test',
        status: 200,
        durationMs: 15,
        responseBody: 'ok',
      },
      25,
    ),
  ]);

  equal(folded.length, 2);
  deepEqual(folded[0], {
    requestId: 'a',
    method: 'GET',
    url: 'https://a.test',
    startT: 10,
    endT: 25,
    status: 200,
    durationMs: 15,
    failed: false,
    responseBody: 'ok',
  });
  equal(folded[1]?.endT, undefined);
  equal(folded[1]?.failed, false);
  equal(folded[1]?.requestBody, '{}');
});

test('foldNetwork keeps a response without a request and marks failed phases', () => {
  const folded = foldNetwork([
    event(
      {
        kind: 'network',
        phase: 'response',
        requestId: 'orphan',
        method: 'GET',
        url: 'https://o.test',
        status: 204,
        durationMs: 3,
      },
      40,
    ),
    event(
      {
        kind: 'network',
        phase: 'failed',
        requestId: 'down',
        method: 'GET',
        url: 'https://d.test',
        errorText: 'net::ERR',
      },
      41,
    ),
  ]);

  equal(folded[0]?.startT, 40);
  equal(folded[0]?.endT, 40);
  equal(folded[1]?.failed, true);
  equal(folded[1]?.errorText, 'net::ERR');
  equal(folded[1]?.endT, 41);
});

test('isFailedRequest is true for failed or status >= 400', () => {
  const rows = [
    { failed: true, expect: true },
    { failed: false, status: 400, expect: true },
    { failed: false, status: 399, expect: false },
    { failed: false, expect: false },
  ];
  for (const row of rows) {
    equal(
      isFailedRequest({
        requestId: 'r',
        method: 'GET',
        url: 'https://x.test',
        startT: 0,
        failed: row.failed,
        status: row.status,
      }),
      row.expect,
    );
  }
});
