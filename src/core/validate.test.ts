import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { isRecord, isString, parseIngestPayload } from './validate.ts';

test('guard helpers', () => {
  equal(isRecord({ a: 1 }), true);
  equal(isRecord([]), false);
  equal(isRecord(null), false);
  equal(isString('x'), true);
  equal(isString(1), false);
});

test('parseIngestPayload accepts the documented fields and defaults', () => {
  const parsed = parseIngestPayload({
    message: 'auth middleware received request',
    source: 'backend/src/auth.ts:42',
    diagnosticSlug: 'auth-token-missing',
    sessionId: 'ses_123',
    level: 'info',
    timestamp: 1733456789000,
    data: { hasAuthHeader: true },
    extra: 'ignored',
  });
  equal(parsed.ok, true);
  if (!parsed.ok) return;
  deepEqual(parsed.value, {
    message: 'auth middleware received request',
    source: 'backend/src/auth.ts:42',
    diagnosticSlug: 'auth-token-missing',
    level: 'info',
    clientTime: new Date(1733456789000).toISOString(),
    data: { hasAuthHeader: true },
  });
});

test('parseIngestPayload maps legacy level spellings and ISO timestamps', () => {
  const warning = parseIngestPayload({ message: 'w', level: 'warning' });
  const log = parseIngestPayload({ message: 'l', level: 'log' });
  const iso = parseIngestPayload({
    message: 't',
    timestamp: '2026-11-02T12:00:00.000Z',
  });
  equal(warning.ok && warning.value.level, 'warn');
  equal(log.ok && log.value.level, 'info');
  equal(iso.ok && iso.value.level, 'info');
  equal(iso.ok && iso.value.clientTime, '2026-11-02T12:00:00.000Z');
});

test('parseIngestPayload rejects invalid bodies with a field-named error', () => {
  const rows: { body: unknown; error: string }[] = [
    { body: null, error: 'payload must be an object.' },
    { body: [], error: 'payload must be an object.' },
    { body: {}, error: 'message is required.' },
    { body: { message: '' }, error: 'message must be a non-empty string.' },
    { body: { message: '   ' }, error: 'message must be a non-empty string.' },
    { body: { message: 1 }, error: 'message must be a non-empty string.' },
    { body: { message: 'ok', source: 1 }, error: 'source must be a string.' },
    {
      body: { message: 'ok', level: 'fatal' },
      error: 'level must be debug, info, warn, or error.',
    },
    { body: { message: 'ok', timestamp: true }, error: 'timestamp must be a string or number.' },
    { body: { message: 'ok', timestamp: 'not-a-date' }, error: 'timestamp is not a valid time.' },
    { body: { message: 'ok', timestamp: Number.NaN }, error: 'timestamp is not a valid time.' },
  ];
  for (const row of rows) {
    const parsed = parseIngestPayload(row.body);
    equal(parsed.ok, false, String(row.error));
    if (parsed.ok) continue;
    equal(parsed.error, row.error);
  }
});
