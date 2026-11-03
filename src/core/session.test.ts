import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { isSessionRecord, isStoredEvent, type SessionRecord, toSummaryInfo } from './session.ts';

const record: SessionRecord = {
  version: 1,
  id: 'x7ootg10qc',
  name: 'login',
  status: 'stopped',
  startedAt: '2026-11-03T02:14:08.000Z',
  stoppedAt: '2026-11-03T02:20:00.000Z',
  projectId: 'k2m8q4zx',
  setup: {
    target: 'browser',
    url: 'http://app.test',
    profile: 'clean',
    record: { actions: true, network: true, console: false },
    endpoint: 'app',
  },
  endpoint: { name: 'app', token: 'ing_aaaaaaaaaaaaaaaaaaaaaaaa' },
};

test('toSummaryInfo maps a record and marks it as not legacy', () => {
  const summary = toSummaryInfo(record, 'D:\\work\\shop');
  equal(summary.legacy, false);
  equal(summary.projectPath, 'D:\\work\\shop');
  equal(summary.id, record.id);
  equal(summary.name, record.name);
  equal(summary.status, record.status);
  deepEqual(summary.setup, record.setup);
  summary.setup.record.actions = false;
  equal(record.setup.record.actions, true);
});

test('isSessionRecord accepts the persisted shape', () => {
  equal(isSessionRecord(record), true);
  equal(isSessionRecord({ ...record, version: 2 }), false);
  equal(isSessionRecord({ ...record, status: 'paused' }), false);
});

test('isStoredEvent checks kinds and common fields only', () => {
  equal(
    isStoredEvent({ id: 'ev_1', seq: 1, at: '2026-01-01T00:00:00.000Z', t: 0, kind: 'note' }),
    true,
  );
  equal(
    isStoredEvent({ id: 'ev_1', seq: 1, at: '2026-01-01T00:00:00.000Z', t: 0, kind: 'ACTION' }),
    false,
  );
  equal(isStoredEvent({ id: 'ev_1', seq: '1', at: 'x', t: 0, kind: 'note' }), false);
});
