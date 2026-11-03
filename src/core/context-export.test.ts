import { equal } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ContextOnly } from './context-export.ts';
import { applyOnlyFilter, contextFileName, renderContext } from './context-export.ts';
import type { TerrificEvent } from './events.ts';
import type { SessionSummaryInfo } from './session.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/context');

function loadCase(name: string): { session: SessionSummaryInfo; events: TerrificEvent[] } {
  return {
    session: JSON.parse(
      readFileSync(join(FIXTURES, `${name}.session.json`), 'utf8'),
    ) as SessionSummaryInfo,
    events: JSON.parse(
      readFileSync(join(FIXTURES, `${name}.events.json`), 'utf8'),
    ) as TerrificEvent[],
  };
}

const CASES: { name: string; source: string; only?: ContextOnly[] }[] = [
  { name: 'browser', source: 'browser' },
  { name: 'ingest', source: 'ingest' },
  { name: 'browser-only', source: 'browser', only: ['bug', 'flag', 'errors'] },
];

test('contextFileName is the fixed storage name', () => {
  equal(contextFileName(), 'context.txt');
});

test('renderContext matches golden files byte for byte', () => {
  for (const row of CASES) {
    const { session, events } = loadCase(row.source);
    const actual = renderContext({ session, events, only: row.only });
    const expected = readFileSync(join(FIXTURES, `${row.name}.context.txt`), 'utf8');
    equal(actual, expected, row.name);
  }
});

test('applyOnlyFilter keeps failed request phases with the errors token', () => {
  const { events } = loadCase('browser');
  const filtered = applyOnlyFilter(events, ['errors']);
  equal(
    filtered.some((event) => event.kind === 'network' && event.requestId === 'req_missing'),
    true,
  );
  equal(
    filtered.some((event) => event.kind === 'console' && event.level === 'warn'),
    false,
  );
});
