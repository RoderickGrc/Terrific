import { deepEqual, equal } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertLegacyEvents, foldedConvertedCount, pairedResponseCount } from './legacy-events.ts';

const START = Date.parse('2026-03-01T10:00:00.000Z');

function rec(
  id: string,
  type: string,
  message: string,
  timestamp: string,
  details?: string,
): Record<string, unknown> {
  if (details === undefined) return { id, type, message, timestamp };
  return { id, type, message, timestamp, details };
}

test('ACTION maps click target and keeps a non-password value', () => {
  const { events, skipped } = convertLegacyEvents(
    [
      rec(
        'ac1',
        'ACTION',
        'Clicked: "Save"',
        '2026-03-01T10:00:01.000Z',
        JSON.stringify({ action: 'click', selector: '#save', xpath: '//button' }),
      ),
      rec(
        'ac2',
        'ACTION',
        'Typed in: "Email"',
        '2026-03-01T10:00:02.000Z',
        JSON.stringify({ action: 'input', selector: '#email', value: 'qa@example.test' }),
      ),
    ],
    START,
  );
  equal(skipped, 0);
  equal(events[0]?.kind, 'action');
  if (events[0]?.kind === 'action') {
    deepEqual(events[0].target, { label: 'Save', selector: '#save', xpath: '//button' });
    equal(events[0].masked, false);
  }
  if (events[1]?.kind === 'action') {
    equal(events[1].action, 'input');
    equal(events[1].value, 'qa@example.test');
  }
});

test('older ACTION details without action use type, built selector, and label fallbacks', () => {
  const longText = `  ${'n'.repeat(90)}  `;
  const rows: Array<{
    name: string;
    message: string;
    details: Record<string, unknown>;
    action: string;
    label: string | undefined;
    selector: string | undefined;
    value?: string;
    valueLength?: number;
    masked?: boolean;
  }> = [
    {
      name: 'type tagName className',
      message: 'Clicked: "Save draft"',
      details: { type: 'click', tagName: 'BUTTON', className: 'btn primary extra unused' },
      action: 'click',
      label: 'Save draft',
      selector: 'button.btn.primary.extra',
    },
    {
      name: 'type tagName className text',
      message: 'Clicked: "Ignore me"',
      details: {
        type: 'click',
        tagName: 'SPAN',
        className: 'link',
        text: '  Open menu  ',
      },
      action: 'click',
      label: 'Open menu',
      selector: 'span.link',
    },
    {
      name: 'type tagName className id',
      message: 'Clicked: "Go"',
      details: { type: 'click', tagName: 'A', className: 'nav', id: 'go-link' },
      action: 'click',
      label: 'go-link',
      selector: 'a#go-link.nav',
    },
    {
      name: 'type tagName className id text',
      message: 'Clicked: "No"',
      details: {
        type: 'click',
        tagName: 'BUTTON',
        className: 'ok',
        id: 'ok-btn',
        text: '  Confirm now  ',
      },
      action: 'click',
      label: 'Confirm now',
      selector: 'button#ok-btn.ok',
    },
    {
      name: 'type tagName className inputType value password',
      message: 'Typed in: "Password"',
      details: {
        type: 'input',
        tagName: 'INPUT',
        className: 'field',
        inputType: 'password',
        value: 'n0t-real',
      },
      action: 'input',
      label: 'Password',
      selector: 'input.field',
      valueLength: 8,
      masked: true,
    },
    {
      name: 'type tagName className inputType text value',
      message: 'Typed in: "Unused"',
      details: {
        type: 'input',
        tagName: 'INPUT',
        className: 'form-control',
        inputType: 'email',
        text: 'Email',
        value: 'qa@shop.test',
      },
      action: 'input',
      label: 'Email',
      selector: 'input.form-control',
      value: 'qa@shop.test',
    },
    {
      name: 'type tagName className id inputType value',
      message: 'Typed in: "Qty"',
      details: {
        type: 'input',
        tagName: 'INPUT',
        className: 'qty',
        id: 'item-qty',
        inputType: 'number',
        value: '3',
      },
      action: 'input',
      label: 'item-qty',
      selector: 'input#item-qty.qty',
      value: '3',
    },
    {
      name: 'type tagName',
      message: 'Clicked: "Docs"',
      details: { type: 'click', tagName: 'A' },
      action: 'click',
      label: 'Docs',
      selector: 'a',
    },
    {
      name: 'type tagName text',
      message: 'Clicked: "Skip"',
      details: { type: 'click', tagName: 'SPAN', text: longText },
      action: 'click',
      label: 'n'.repeat(80),
      selector: 'span',
    },
  ];

  for (const row of rows) {
    const { events, skipped } = convertLegacyEvents(
      [rec('old1', 'ACTION', row.message, '2026-03-01T10:00:01.000Z', JSON.stringify(row.details))],
      START,
    );
    equal(skipped, 0, row.name);
    const event = events[0];
    equal(event?.kind, 'action', row.name);
    if (event?.kind !== 'action') continue;
    equal(event.action, row.action, row.name);
    equal(event.target.label, row.label, row.name);
    equal(event.target.selector, row.selector, row.name);
    equal(event.value, row.value, row.name);
    equal(event.valueLength, row.valueLength, row.name);
    equal(event.masked, row.masked === true, row.name);
  }
});

test('older ACTION change on SELECT becomes select and unknown type is skipped', () => {
  const { events, skipped } = convertLegacyEvents(
    [
      rec(
        'sel1',
        'ACTION',
        'Changed: "Country"',
        '2026-03-01T10:00:01.000Z',
        JSON.stringify({ type: 'change', tagName: 'SELECT', className: 'pick', value: 'mx' }),
      ),
      rec(
        'bad1',
        'ACTION',
        'Clicked: "X"',
        '2026-03-01T10:00:02.000Z',
        JSON.stringify({ type: 'hover', tagName: 'DIV' }),
      ),
      rec(
        'bad2',
        'ACTION',
        'plain note',
        '2026-03-01T10:00:03.000Z',
        JSON.stringify({ tagName: 'BUTTON', className: 'x' }),
      ),
    ],
    START,
  );
  equal(skipped, 2);
  equal(events.length, 1);
  if (events[0]?.kind === 'action') {
    equal(events[0].action, 'select');
    equal(events[0].value, 'mx');
    equal(events[0].target.selector, 'select.pick');
    equal(events[0].target.label, 'Country');
  }
});

test('ACTION masks passwords and uses selected text for select changes', () => {
  const { events } = convertLegacyEvents(
    [
      rec(
        'ac3',
        'ACTION',
        'Typed in: "Password"',
        '2026-03-01T10:00:01.000Z',
        JSON.stringify({ action: 'input', inputType: 'password', value: 'secret', masked: true }),
      ),
      rec(
        'ac4',
        'ACTION',
        'Changed: "Country"',
        '2026-03-01T10:00:02.000Z',
        JSON.stringify({
          action: 'change',
          element: 'SELECT',
          value: 'mx',
          selectedText: 'Mexico',
        }),
      ),
    ],
    START,
  );
  if (events[0]?.kind === 'action') {
    equal(events[0].masked, true);
    equal(events[0].value, undefined);
    equal(events[0].valueLength, 6);
  }
  if (events[1]?.kind === 'action') {
    equal(events[1].action, 'select');
    equal(events[1].value, 'Mexico');
  }
});

test('NETWORK pairs two identical in-flight GETs in arrival order', () => {
  const { events } = convertLegacyEvents(
    [
      rec('r1', 'NETWORK', 'GET https://example.test/items', '2026-03-01T10:00:01.000Z'),
      rec('r2', 'NETWORK', 'GET https://example.test/items', '2026-03-01T10:00:02.000Z'),
      rec(
        's1',
        'NETWORK',
        '200 https://example.test/items',
        '2026-03-01T10:00:03.000Z',
        JSON.stringify({ method: 'GET', status: 200, url: 'https://example.test/items' }),
      ),
      rec(
        's2',
        'NETWORK',
        '404 https://example.test/items',
        '2026-03-01T10:00:04.000Z',
        JSON.stringify({ method: 'GET', status: 404, url: 'https://example.test/items' }),
      ),
    ],
    START,
  );
  const nets = events.filter((event) => event.kind === 'network');
  equal(nets[0]?.requestId, 'legacy-1');
  equal(nets[1]?.requestId, 'legacy-2');
  equal(nets[2]?.requestId, 'legacy-1');
  equal(nets[3]?.requestId, 'legacy-2');
  if (nets[2]?.kind === 'network') equal(nets[2].status, 200);
  if (nets[3]?.kind === 'network') equal(nets[3].phase, 'response');
  equal(pairedResponseCount(events), 2);
  equal(foldedConvertedCount(events), 2);
});

test('NETWORK ignores volatile t and v query params when pairing', () => {
  const { events } = convertLegacyEvents(
    [
      rec('r1', 'NETWORK', 'GET https://example.test/api?t=1&keep=1', '2026-03-01T10:00:01.000Z'),
      rec(
        's1',
        'NETWORK',
        '200 https://example.test/api?t=9&keep=1',
        '2026-03-01T10:00:02.000Z',
        JSON.stringify({ method: 'GET', status: 200, url: 'https://example.test/api?t=9&keep=1' }),
      ),
    ],
    START,
  );
  const first = events[0];
  const second = events[1];
  equal(first?.kind === 'network' && second?.kind === 'network', true);
  if (first?.kind === 'network' && second?.kind === 'network') {
    equal(first.requestId, second.requestId);
  }
});

test('NETWORK marks a failed record and keeps request bodies', () => {
  const { events } = convertLegacyEvents(
    [
      rec(
        'r1',
        'NETWORK',
        'POST https://example.test/save',
        '2026-03-01T10:00:01.000Z',
        JSON.stringify({ body: { name: 'Ada' } }),
      ),
      rec(
        'f1',
        'NETWORK',
        'GET https://example.test/gone',
        '2026-03-01T10:00:02.000Z',
        JSON.stringify({
          method: 'GET',
          url: 'https://example.test/gone',
          failed: true,
          errorText: 'net::ERR',
        }),
      ),
    ],
    START,
  );
  if (events[0]?.kind === 'network') equal(events[0].requestBody, '{"name":"Ada"}');
  if (events[1]?.kind === 'network') {
    equal(events[1].phase, 'failed');
    equal(events[1].errorText, 'net::ERR');
  }
});

test('CONSOLE PAGE_RELOAD SNAPSHOT CRAWL and SCREENSHOT convert', () => {
  const { events, skipped } = convertLegacyEvents(
    [
      rec('c1', 'CONSOLE', 'Console warning: stale', '2026-03-01T10:00:01.000Z', 'stale'),
      rec('c2', 'CONSOLE', 'hello', '2026-03-01T10:00:02.000Z'),
      rec(
        'p1',
        'PAGE_RELOAD',
        'Page reloaded: https://example.test/app',
        '2026-03-01T10:00:03.000Z',
        JSON.stringify({ url: 'https://example.test/app', title: 'App' }),
      ),
      rec(
        's1',
        'SNAPSHOT',
        'Page snapshot: Home (3 words)',
        '2026-03-01T10:00:04.000Z',
        JSON.stringify({
          url: 'https://example.test/',
          title: 'Home',
          wordCount: 3,
          markdown: '# Home',
        }),
      ),
      rec('cr1', 'CRAWL', 'Page snapshot: Empty', '2026-03-01T10:00:05.000Z', JSON.stringify({})),
      rec(
        'ss1',
        'SCREENSHOT',
        'Screenshot captured',
        '2026-03-01T10:00:06.000Z',
        JSON.stringify({ filename: 'screenshot-1.png', size: 12 }),
      ),
    ],
    START,
  );
  equal(skipped, 0);
  if (events[0]?.kind === 'console') equal(events[0].level, 'warn');
  if (events[1]?.kind === 'console') equal(events[1].level, 'log');
  if (events[2]?.kind === 'navigation') equal(events[2].title, 'App');
  if (events[3]?.kind === 'snapshot') equal(events[3].markdown, '# Home');
  if (events[4]?.kind === 'snapshot') {
    equal(events[4].url, '');
    equal(events[4].wordCount, 0);
  }
  if (events[5]?.kind === 'screenshot') equal(events[5].bytes, 12);
});

test('NOTE BUG FLAG SERVER_LOG and SESSION_STOPPED convert', () => {
  const { events } = convertLegacyEvents(
    [
      rec('n1', 'NOTE', 'typed observation', '2026-03-01T10:00:01.000Z'),
      rec('b1', 'BUG', 'Bug reported', '2026-03-01T10:00:02.000Z'),
      rec('b2', 'BUG', 'checkout totals', '2026-03-01T10:00:03.000Z'),
      rec('f1', 'FLAG', 'Flagged point of interest', '2026-03-01T10:00:04.000Z'),
      rec('f2', 'FLAG', '', '2026-03-01T10:00:05.000Z'),
      rec(
        'sv1',
        'SERVER_LOG',
        'pool stall',
        '2026-03-01T10:00:06.000Z',
        JSON.stringify({
          lvl: 'warning',
          src: 'worker',
          diagnosticSlug: 'pool-stall',
          timestamp: '2026-03-01T10:00:05.500Z',
          data: { wait: 12 },
        }),
      ),
      rec('st1', 'SESSION_STOPPED', 'Session stopped', '2026-03-01T10:00:07.000Z'),
    ],
    START,
  );
  if (events[0]?.kind === 'note') equal(events[0].author, 'tester');
  if (events[1]?.kind === 'bug') equal(events[1].text, null);
  if (events[2]?.kind === 'bug') equal(events[2].text, 'checkout totals');
  if (events[3]?.kind === 'flag') equal(events[3].text, null);
  if (events[4]?.kind === 'flag') equal(events[4].text, null);
  if (events[5]?.kind === 'ingest') {
    equal(events[5].endpoint, 'legacy');
    equal(events[5].level, 'warn');
    equal(events[5].source, 'worker');
    equal(events[5].diagnosticSlug, 'pool-stall');
    deepEqual(events[5].data, { wait: 12 });
  }
  if (events[6]?.kind === 'lifecycle') equal(events[6].state, 'stopped');
});

test('skips unreadable records, sorts by timestamp, and never emits negative t', () => {
  const { events, skipped } = convertLegacyEvents(
    [
      rec('late', 'NOTE', 'later', '2026-03-01T10:00:03.000Z'),
      rec('early', 'NOTE', 'earlier', '2026-03-01T09:59:59.000Z'),
      { id: 'x', type: 'NOTE', message: 'no time' },
      rec('bad', 'UNKNOWN', 'nope', '2026-03-01T10:00:01.000Z'),
      rec('act', 'ACTION', 'Clicked: "X"', '2026-03-01T10:00:02.000Z', 'not-json'),
    ],
    START,
  );
  equal(skipped, 3);
  equal(events[0]?.id, 'early');
  equal(events[0]?.t, 0);
  equal(events[1]?.seq, 1);
  equal(events[1]?.id, 'late');
});

test('fixture sample pairs a request to its response', async () => {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../test/fixtures/legacy/events-sample.json',
  );
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const { events, skipped } = convertLegacyEvents(Array.isArray(raw) ? raw : [], START);
  equal(skipped, 0);
  equal(events.length, 3);
  equal(pairedResponseCount(events), 1);
});
