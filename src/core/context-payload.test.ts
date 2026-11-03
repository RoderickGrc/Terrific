import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactIngestData,
  extractSchemaOnly,
  flattenSnapshotMarkdown,
  processPayloadRecursive,
  summarizeResponseBody,
  truncateWithContext,
} from './context-payload.ts';

test('truncateWithContext keeps short text, both ends, and data URI prefixes', () => {
  equal(truncateWithContext('short'), 'short');
  const long = `${'a'.repeat(60)}${'b'.repeat(60)}`;
  equal(truncateWithContext(long), `${'a'.repeat(50)}[...]${'b'.repeat(50)}`);
  equal(truncateWithContext('data:image/png;base64,AAAA'), 'data:image/png;base64');
});

test('processPayloadRecursive truncates strings and samples long arrays', () => {
  deepEqual(processPayloadRecursive({ ok: true, s: 'ab' }), { ok: true, s: 'ab' });
  equal(processPayloadRecursive(['a', 'b', 'c', 'd']), 'items[4]: ["a","b"...]');
  deepEqual(processPayloadRecursive(['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('extractSchemaOnly and summarizeResponseBody keep structure, not values', () => {
  equal(
    extractSchemaOnly({ id: 'usr_1', role: 'admin', nested: { a: 1 } }),
    '{id:string, role:string, nested}',
  );
  equal(extractSchemaOnly([{ n: 1 }, { n: 2 }]), '[{n}]×2');
  equal(summarizeResponseBody('{"id":"usr_1","ok":true}'), '{id:string, ok:boolean}');
  equal(summarizeResponseBody('plain text body'), 'plain text body');
});

test('compactIngestData drops empty payloads and flattenSnapshotMarkdown joins lines', () => {
  equal(compactIngestData({}), undefined);
  deepEqual(compactIngestData({ n: 1 }), { n: 1 });
  equal(flattenSnapshotMarkdown('Hello\n\nWorld'), 'Hello ¶ World');
});
