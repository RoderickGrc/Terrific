import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { describeEvent, formatEventLine } from './event-line.ts';
import type { EventInput, TerrificEvent } from './events.ts';

function event(input: EventInput, t = 0): TerrificEvent {
  return { id: 'ev_line000001', seq: 1, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

test('describeEvent formats network pending, ok, 4xx and failed', () => {
  deepEqual(
    describeEvent(
      event({
        kind: 'network',
        phase: 'request',
        requestId: 'r1',
        method: 'GET',
        url: 'http://localhost:5173/api/items',
      }),
    ),
    {
      tag: 'net',
      content: 'GET localhost:5173/api/items',
      detail: 'pending',
      tone: 'normal',
    },
  );
  deepEqual(
    describeEvent(
      event({
        kind: 'network',
        phase: 'response',
        requestId: 'r1',
        method: 'GET',
        url: 'http://localhost:5173/api/items',
        status: 200,
        durationMs: 45,
      }),
    ),
    {
      tag: 'net',
      content: 'GET localhost:5173/api/items',
      detail: '200 · 45ms',
      tone: 'normal',
    },
  );
  equal(
    describeEvent(
      event({
        kind: 'network',
        phase: 'response',
        requestId: 'r2',
        method: 'POST',
        url: 'https://very-long-example-host.example.com/x',
        status: 404,
        durationMs: 12,
      }),
    ).tone,
    'error',
  );
  equal(
    describeEvent(
      event({
        kind: 'network',
        phase: 'failed',
        requestId: 'r3',
        method: 'GET',
        url: 'http://127.0.0.1:9/',
        errorText: 'net::ERR',
      }),
    ).detail,
    'net::ERR',
  );
});

test('describeEvent formats console, actions, navigation, captures and marks', () => {
  equal(describeEvent(event({ kind: 'console', level: 'error', text: 'boom' })).tone, 'error');
  equal(describeEvent(event({ kind: 'console', level: 'warn', text: 'careful' })).tone, 'warn');
  equal(
    describeEvent(
      event({ kind: 'action', action: 'click', target: { label: 'Save' }, masked: false }),
    ).content,
    'click "Save"',
  );
  equal(
    describeEvent(
      event({
        kind: 'action',
        action: 'input',
        target: { label: 'Email' },
        value: 'user@x',
        masked: false,
      }),
    ).content,
    'type "Email" = user@x',
  );
  equal(
    describeEvent(
      event({
        kind: 'action',
        action: 'input',
        target: { label: 'Password' },
        masked: true,
        valueLength: 8,
      }),
    ).content,
    'type "Password" (8 chars hidden)',
  );
  equal(
    describeEvent(
      event({
        kind: 'action',
        action: 'select',
        target: { label: 'Country' },
        value: 'Spain',
        masked: false,
      }),
    ).content,
    'select "Country" = Spain',
  );
  const nav = describeEvent(
    event({ kind: 'navigation', url: 'http://localhost:5173/', title: 'Home' }),
  );
  equal(nav.content, 'http://localhost:5173/');
  equal(nav.detail, 'Home');
  const snap = describeEvent(
    event({
      kind: 'snapshot',
      url: 'http://localhost:5173/',
      title: 'Home',
      wordCount: 12,
      markdown: 'Hi',
    }),
  );
  equal(snap.content, 'Home');
  equal(snap.detail, '12 words');
  equal(
    describeEvent(event({ kind: 'screenshot', file: 'D:\\work\\ss_abc.png', bytes: 10 })).content,
    'ss_abc.png',
  );
  equal(describeEvent(event({ kind: 'bug', text: null, author: 'agent' })).tone, 'muted');
  equal(describeEvent(event({ kind: 'bug', text: null, author: 'agent' })).content, 'Bug reported');
  equal(
    describeEvent(event({ kind: 'flag', text: null, author: 'agent' })).content,
    'Flagged point of interest',
  );
});

test('describeEvent formats ingest by level and lifecycle as muted', () => {
  const ingest = describeEvent(
    event({
      kind: 'ingest',
      endpoint: 'app',
      message: 'ready',
      source: 'worker',
      level: 'info',
    }),
  );
  equal(ingest.content, 'ready');
  equal(ingest.detail, 'app · worker');
  equal(ingest.tone, 'normal');
  const down = event({ kind: 'ingest', endpoint: 'app', message: 'down', level: 'error' });
  equal(describeEvent(down).tone, 'error');
  const life = describeEvent(event({ kind: 'lifecycle', state: 'stopped' }));
  equal(life.tag, 'life');
  equal(life.content, 'stopped');
  equal(life.tone, 'muted');
});

test('formatEventLine uses mm:ss.d and a 6-wide tag column', () => {
  equal(
    formatEventLine(
      event(
        {
          kind: 'network',
          phase: 'response',
          requestId: 'r1',
          method: 'GET',
          url: 'http://localhost:5173/api',
          status: 200,
          durationMs: 45,
        },
        3200,
      ),
    ),
    '00:03.2  net     GET localhost:5173/api  200 · 45ms',
  );
  equal(
    formatEventLine(event({ kind: 'note', text: 'hello', author: 'agent' }, 100)),
    '00:00.1  note    hello',
  );
});
