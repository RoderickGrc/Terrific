import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { parseActionPayload } from './action-payload.ts';

test('parseActionPayload accepts a click and drops unknown fields', () => {
  deepEqual(
    parseActionPayload({
      action: 'click',
      target: { label: 'Save', selector: '#submit', xpath: '//*[@id="submit"]' },
      masked: false,
      extra: true,
    }),
    {
      kind: 'action',
      action: 'click',
      target: { label: 'Save', selector: '#submit', xpath: '//*[@id="submit"]' },
      masked: false,
    },
  );
});

test('parseActionPayload never keeps a password value', () => {
  const parsed = parseActionPayload({
    action: 'input',
    target: { label: 'Password' },
    masked: true,
    value: 's3cret',
    valueLength: 6,
  });
  equal(parsed?.kind, 'action');
  if (parsed?.kind !== 'action') return;
  equal(parsed.masked, true);
  equal(parsed.valueLength, 6);
  equal(parsed.value, undefined);
});

test('parseActionPayload rejects untrusted shapes', () => {
  equal(parseActionPayload(null), null);
  equal(parseActionPayload({ action: 'click' }), null);
  equal(parseActionPayload({ action: 'zoom', target: {}, masked: false }), null);
  equal(parseActionPayload({ action: 'click', target: {}, masked: 'yes' }), null);
});
