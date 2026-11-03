import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { EventInput, TerrificEvent } from './events.ts';
import { DEFAULT_MARK_TEXT, EVENT_KINDS, isErrorEvent } from './events.ts';

function event(input: EventInput, t = 0): TerrificEvent {
  return { id: 'ev_test000001', seq: 1, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

const CASES: { name: string; event: TerrificEvent; error: boolean }[] = [
  {
    name: 'network failed phase',
    event: event({
      kind: 'network',
      phase: 'failed',
      requestId: 'r1',
      method: 'GET',
      url: 'https://x.test',
      errorText: 'reset',
    }),
    error: true,
  },
  {
    name: 'network 400',
    event: event({
      kind: 'network',
      phase: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'https://x.test',
      status: 400,
    }),
    error: true,
  },
  {
    name: 'network 500',
    event: event({
      kind: 'network',
      phase: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'https://x.test',
      status: 500,
    }),
    error: true,
  },
  {
    name: 'network 200',
    event: event({
      kind: 'network',
      phase: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'https://x.test',
      status: 200,
    }),
    error: false,
  },
  {
    name: 'network request without status',
    event: event({
      kind: 'network',
      phase: 'request',
      requestId: 'r1',
      method: 'GET',
      url: 'https://x.test',
    }),
    error: false,
  },
  {
    name: 'console error',
    event: event({ kind: 'console', level: 'error', text: 'boom' }),
    error: true,
  },
  {
    name: 'console warn',
    event: event({ kind: 'console', level: 'warn', text: 'careful' }),
    error: false,
  },
  {
    name: 'ingest error',
    event: event({
      kind: 'ingest',
      endpoint: 'app',
      message: 'failed',
      level: 'error',
    }),
    error: true,
  },
  {
    name: 'ingest info',
    event: event({
      kind: 'ingest',
      endpoint: 'app',
      message: 'ok',
      level: 'info',
    }),
    error: false,
  },
  {
    name: 'action',
    event: event({
      kind: 'action',
      action: 'click',
      target: { label: 'Save' },
      masked: false,
    }),
    error: false,
  },
  {
    name: 'bug is not an error event',
    event: event({ kind: 'bug', text: null, author: 'tester' }),
    error: false,
  },
];

test('isErrorEvent', () => {
  for (const row of CASES) {
    equal(isErrorEvent(row.event), row.error, row.name);
  }
});

test('EVENT_KINDS lists every kind once', () => {
  equal(EVENT_KINDS.length, 11);
  equal(new Set(EVENT_KINDS).size, 11);
});

test('DEFAULT_MARK_TEXT matches terrific web labels', () => {
  equal(DEFAULT_MARK_TEXT.bug, 'Bug reported');
  equal(DEFAULT_MARK_TEXT.flag, 'Flagged point of interest');
});
