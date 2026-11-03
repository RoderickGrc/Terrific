import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { TerrificEvent } from '../core/events.ts';
import { LiveLog } from './live-log.ts';

let seq = 0;
function event(input: Record<string, unknown>, t: number): TerrificEvent {
  seq += 1;
  return { id: `e${seq}`, seq, at: '2026-03-02T10:00:00.000Z', t, ...input } as TerrificEvent;
}

const visibleAll = { action: true, network: true, console: true, ingest: true };

test('a response updates its request line in place and keeps the request time', () => {
  const log = new LiveLog();
  const base = { kind: 'network', requestId: 'r1', method: 'POST', url: 'http://x.test/api' };
  equal(log.add(event({ ...base, phase: 'request' }, 100)), true);
  equal(log.add(event({ ...base, phase: 'response', status: 201, durationMs: 30 }, 130)), false);
  equal(log.entries.length, 1);
  const line = log.entries[0]?.event;
  equal(line?.kind === 'network' ? line.status : undefined, 201);
  equal(line?.t, 100);
});

test('repeated ids are ignored, so a backlog and a stream can overlap', () => {
  const log = new LiveLog();
  const note = event({ kind: 'note', text: 'hi', author: 'tester' }, 10);
  log.add(note);
  equal(log.add(note), false);
  equal(log.entries.length, 1);
});

test('hidden types leave the visible lines but still count', () => {
  const log = new LiveLog();
  log.add(event({ kind: 'console', level: 'error', text: 'boom' }, 1));
  log.add(event({ kind: 'bug', text: null, author: 'tester' }, 2));
  log.add(event({ kind: 'lifecycle', state: 'started' }, 0));
  equal(log.visible({ ...visibleAll, console: false }).length, 2);
  const counts = log.counts();
  deepEqual([counts.total, counts.console, counts.bugs, counts.errors], [2, 1, 1, 1]);
});
