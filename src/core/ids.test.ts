import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { test } from 'node:test';
import type { RandomSource } from './ids.ts';
import {
  isProjectId,
  isSessionId,
  newEndpointToken,
  newEventId,
  newProjectId,
  newSessionId,
  parseSessionFolderName,
  randomId,
  sessionFolderName,
} from './ids.ts';

function fill(value: number): RandomSource {
  return (bytes) => Uint8Array.from({ length: bytes }, () => value);
}

test('randomId uses [a-z0-9] and the requested length', () => {
  const id = randomId(32, fill(0));
  equal(id.length, 32);
  match(id, /^[a-z0-9]+$/);
});

test('id helpers use the documented lengths and prefixes', () => {
  const random = fill(10);
  equal(newProjectId(random).length, 8);
  ok(isProjectId(newProjectId(random)));
  equal(newSessionId(random).length, 10);
  ok(isSessionId(newSessionId(random)));
  match(newEventId(random), /^ev_[a-z0-9]{12}$/);
  match(newEndpointToken(random), /^ing_[a-z0-9]{24}$/);
});

test('isProjectId and isSessionId reject wrong shape', () => {
  equal(isProjectId('k2m8q4zx'), true);
  equal(isProjectId('K2M8Q4ZX'), false);
  equal(isProjectId('k2m8q4z'), false);
  equal(isProjectId('k2m8q4zxx'), false);
  equal(isSessionId('x7ootg10qc'), true);
  equal(isSessionId('x7ootg10q'), false);
  equal(isSessionId('X7OOTG10QC'), false);
});

test('session folder name round-trips across a UTC midnight boundary', () => {
  const before = new Date('2026-11-03T00:00:00.000Z');
  before.setUTCMilliseconds(0);
  before.setUTCSeconds(before.getUTCSeconds() - 1);
  const after = new Date('2026-11-03T00:00:01.000Z');
  const id = 'x7ootg10qc';

  const beforeName = sessionFolderName(id, before);
  const afterName = sessionFolderName(id, after);
  equal(beforeName, '2026-11-02_23-59-59_x7ootg10qc');
  equal(afterName, '2026-11-03_00-00-01_x7ootg10qc');

  const parsedBefore = parseSessionFolderName(beforeName);
  const parsedAfter = parseSessionFolderName(afterName);
  ok(parsedBefore);
  ok(parsedAfter);
  equal(parsedBefore.id, id);
  equal(parsedAfter.id, id);
  equal(parsedBefore.startedAt.toISOString(), '2026-11-02T23:59:59.000Z');
  equal(parsedAfter.startedAt.toISOString(), '2026-11-03T00:00:01.000Z');
});

test('parseSessionFolderName rejects malformed names', () => {
  const names = [
    '',
    'x7ootg10qc',
    '2026-11-03_02-14-08',
    '2026-11-03_02-14-08_',
    '2026-11-03T02-14-08_x7ootg10qc',
    '2026-11-03_02-14-08_X7OOTG10QC',
    '2026-11-03_02-14-08_x7ootg10qc_extra',
    '2026-13-01_00-00-00_x7ootg10qc',
    '2026-02-30_00-00-00_x7ootg10qc',
    '2026-11-03_24-00-00_x7ootg10qc',
  ];
  for (const name of names) {
    equal(parseSessionFolderName(name), null, name);
  }
});

test('sessionFolderName uses UTC even when the local date would differ', () => {
  const startedAt = new Date(Date.UTC(2026, 10, 3, 2, 14, 8));
  deepEqual(parseSessionFolderName(sessionFolderName('abc123xyz0', startedAt)), {
    id: 'abc123xyz0',
    startedAt,
  });
});
