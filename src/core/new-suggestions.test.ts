import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { NewContext } from './new-command.ts';
import { parseNewLine } from './new-command.ts';
import type { Suggestion } from './new-suggestions.ts';
import { applySuggestion, suggestNew } from './new-suggestions.ts';
import type { EndpointOption, SessionSetup } from './setup.ts';

const last: SessionSetup = {
  target: 'browser',
  url: 'https://app.example.com/',
  profile: 'testing',
  record: { actions: true, network: true, console: true },
  endpoint: 'app',
};

const context: NewContext & { recentUrls: string[] } = {
  last,
  profiles: [
    { slug: 'testing', label: 'Testing', detail: 'daily browser' },
    { slug: 'work', label: 'Work', detail: 'office profile' },
    {
      slug: 'chrome',
      label: 'Chrome',
      detail: 'system Chrome',
      blockedReason: 'Chrome blocks automation of its default profile',
    },
  ],
  endpoints: [
    { name: 'app', state: 'open', eventCount: 12, lastEventAt: 50 },
    { name: 'worker', state: 'closed', eventCount: 2, lastEventAt: 10 },
  ] satisfies EndpointOption[],
  recentUrls: ['https://localhost:5173/', 'https://app.example.com/login', 'http://127.0.0.1:3000'],
};

function parsed(line: string) {
  return parseNewLine(line, context);
}

function labels(items: Suggestion[]) {
  return items.map((item) => item.label);
}

test('caret on whitespace suggests recent URLs and the three prefixes', () => {
  const line = 'notes ';
  const items = suggestNew(parsed(line), line.length, context);
  deepEqual(labels(items), [
    'localhost:5173/',
    'app.example.com/login',
    '127.0.0.1:3000',
    '@profile',
    '#endpoint',
    '--flag',
  ]);
  deepEqual(
    items.slice(3).map((item) => [item.insert, item.detail]),
    [
      ['@', 'browser profile'],
      ['#', 'the ingest endpoint for this session'],
      ['--', 'no browser, what to record'],
    ],
  );
});

test('caret on whitespace after a URL omits recent URLs', () => {
  const line = 'localhost:5173 ';
  const items = suggestNew(parsed(line), line.length, context);
  deepEqual(labels(items), ['@profile', '#endpoint', '--flag']);
});

test('caret on whitespace omits the parts the line already has', () => {
  const line = 'localhost:5173 @clean #app ';
  deepEqual(labels(suggestNew(parsed(line), line.length, context)), ['--flag']);
  const noBrowser = 'notes --no-browser --no-ingest ';
  deepEqual(labels(suggestNew(parsed(noBrowser), noBrowser.length, context)).slice(3), ['--flag']);
});

test('caret on @q lists matching profiles and disables blocked ones', () => {
  const line = '@te';
  const items = suggestNew(parsed(line), line.length, context);
  equal(items.length <= 6, true);
  deepEqual(items[0], {
    insert: '@testing',
    label: '@testing',
    detail: 'Testing · daily browser',
  });
  const chrome = suggestNew(parsed('@c'), 2, context).find((item) => item.label === '@chrome');
  deepEqual(chrome, {
    insert: '@chrome',
    label: '@chrome',
    detail: 'Chrome · system Chrome',
    disabled: true,
  });
});

test('caret on #q lists endpoints and create this endpoint', () => {
  const onHash = suggestNew(parsed('#'), 1, context);
  deepEqual(onHash, [
    { insert: '#app', label: '#app', detail: 'open · 12 events' },
    { insert: '#worker', label: '#worker', detail: 'closed, reopens on start' },
  ]);
  const create = suggestNew(parsed('#fresh'), 6, context);
  deepEqual(create.at(-1), {
    insert: '#fresh',
    label: '#fresh',
    detail: 'create this endpoint',
  });
  const filtered = suggestNew(parsed('#w'), 2, context);
  // A prefix of an existing endpoint is also a valid new name, so both are offered.
  deepEqual(labels(filtered), ['#worker', '#w']);
});

test('caret on --q lists remaining flags with their descriptions', () => {
  const all = suggestNew(parsed('--'), 2, context);
  deepEqual(
    all.map((item) => [item.insert, item.detail]),
    [
      ['--no-browser', 'record without a browser'],
      ['--no-actions', 'do not record actions'],
      ['--no-network', 'do not record network'],
      ['--no-console', 'do not record console'],
      ['--no-ingest', 'no ingest endpoint'],
    ],
  );
  const prefix = suggestNew(parsed('--no-a'), 6, context);
  deepEqual(labels(prefix), ['--no-actions']);
  deepEqual(suggestNew(parsed('--no-actions'), 12, context), []);
});

test('caret on a URL or a would-be URL word suggests recent URLs', () => {
  const onUrl = suggestNew(parsed('local'), 5, context);
  deepEqual(labels(onUrl), ['localhost:5173/']);
  const https = suggestNew(parsed('https://app'), 11, context);
  deepEqual(labels(https), ['app.example.com/login']);
  equal(suggestNew(parsed('localhost:5173'), 14, context).length <= 4, true);
});

test('quoted token has no suggestions', () => {
  const line = '"api.v2"';
  deepEqual(suggestNew(parsed(line), 3, context), []);
});

test('applySuggestion replaces the token under the caret and places the caret', () => {
  const line = '@te';
  const applied = applySuggestion(line, 3, parsed(line), {
    insert: '@testing',
    label: '@testing',
    detail: 'Testing · daily browser',
  });
  deepEqual(applied, { line: '@testing ', caret: 9 });
});

test('applySuggestion inserts at the caret after a space and skips glue for @ # -', () => {
  const line = 'notes ';
  const parsedLine = parsed(line);
  const at = applySuggestion(line, line.length, parsedLine, {
    insert: '@',
    label: '@profile',
    detail: 'browser profile',
  });
  deepEqual(at, { line: 'notes @', caret: 7 });
  const url = applySuggestion(line, line.length, parsedLine, {
    insert: 'localhost:5173/',
    label: 'localhost:5173/',
    detail: 'recent URL',
  });
  deepEqual(url, { line: 'notes localhost:5173/ ', caret: 22 });
  const flag = applySuggestion(line, line.length, parsedLine, {
    insert: '--',
    label: '--flag',
    detail: 'no browser, what to record',
  });
  deepEqual(flag, { line: 'notes --', caret: 8 });
});

test('applySuggestion does not leave a double space after the insert', () => {
  const line = 'lo leftover';
  const applied = applySuggestion(line, 2, parsed(line), {
    insert: 'localhost:5173',
    label: 'localhost:5173',
    detail: 'recent URL',
  });
  deepEqual(applied, { line: 'localhost:5173 leftover', caret: 15 });
});
