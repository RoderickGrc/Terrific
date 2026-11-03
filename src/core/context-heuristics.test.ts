import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import {
  collapseViteReloadNoise,
  debounceInputEvents,
  filterStaticResources,
  isDroppedDevUrl,
  isStaticAssetUrl,
  isViteBurst,
} from './context-heuristics.ts';
import type { EventInput, TerrificEvent } from './events.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}`, seq: t, at: '2026-01-01T00:00:00.000Z', t, ...input };
}

function net(
  requestId: string,
  url: string,
  t: number,
  extra: Partial<Extract<EventInput, { kind: 'network' }>> = {},
): TerrificEvent {
  return event(
    {
      kind: 'network',
      phase: extra.phase ?? 'response',
      requestId,
      method: extra.method ?? 'GET',
      url,
      status: extra.status ?? 200,
      durationMs: extra.durationMs,
    },
    t,
  );
}

test('debounceInputEvents keeps the last value on the same target', () => {
  const first = event(
    {
      kind: 'action',
      action: 'input',
      target: { selector: '#email', label: 'Email' },
      value: 'a',
      masked: false,
    },
    1,
  );
  const last = event(
    {
      kind: 'action',
      action: 'input',
      target: { selector: '#email', label: 'Email' },
      value: 'ada',
      masked: false,
    },
    2,
  );
  const click = event(
    {
      kind: 'action',
      action: 'click',
      target: { label: 'Go' },
      masked: false,
    },
    3,
  );
  const other = event(
    {
      kind: 'action',
      action: 'input',
      target: { selector: '#name' },
      value: 'x',
      masked: false,
    },
    4,
  );
  const out = debounceInputEvents([first, last, click, other]);
  equal(out.length, 3);
  equal(out[0], last);
  equal(out[1], click);
  equal(out[2], other);
});

test('filterStaticResources drops images, css, maps, vite and HMR, keeps failures', () => {
  equal(isStaticAssetUrl('http://app.test/logo.png'), true);
  equal(isStaticAssetUrl('http://app.test/app.css'), true);
  equal(isStaticAssetUrl('http://app.test/app.js.map'), true);
  equal(isDroppedDevUrl('http://localhost:5173/@vite/client'), true);
  equal(isDroppedDevUrl('http://localhost:5173/__vite_ping'), true);
  const kept = event(
    {
      kind: 'action',
      action: 'click',
      target: { label: 'X' },
      masked: false,
    },
    1,
  );
  const out = filterStaticResources([
    kept,
    net('img', 'http://app.test/logo.png', 2),
    net('css', 'http://localhost:5173/app.css', 3),
    net('vite', 'http://localhost:5173/@vite/client', 4),
    net('ping', 'http://localhost:5173/__vite_ping', 5),
    net('api', 'http://app.test/api/items', 6),
    net('miss', 'http://app.test/logo.png', 7, { status: 404 }),
  ]);
  equal(out.length, 3);
  equal(out[0], kept);
  deepEqual(
    out.filter((row) => row.kind === 'network').map((row) => row.requestId),
    ['api', 'miss'],
  );
});

test('collapseViteReloadNoise replaces a local /src/ burst with one summary', () => {
  const click = event(
    {
      kind: 'action',
      action: 'click',
      target: { label: 'X' },
      masked: false,
    },
    1,
  );
  const a = net('a', 'http://localhost:5173/src/main.ts', 10);
  const b = net('b', 'http://localhost:5173/src/App.tsx', 20);
  const c = net('c', 'http://app.test/src/main.ts', 30);
  const out = collapseViteReloadNoise([click, a, b, c]);
  equal(out.length, 3);
  equal(out[0], click);
  const burst = out[1];
  if (burst === undefined || !isViteBurst(burst)) throw new Error('expected a Vite burst');
  equal(burst.count, 2);
  equal(burst.uniqueUrlCount, 2);
  equal(out[2], c);
});
