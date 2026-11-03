import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { EndpointOption } from './setup.ts';
import {
  assignProfileSlugs,
  defaultEndpoint,
  displayUrl,
  isEndpointName,
  isUrlAttempt,
  isUrlWord,
  normalizeUrl,
} from './setup.ts';

test('assignProfileSlugs lowercases, collapses, and reserves clean', () => {
  const options = assignProfileSlugs([
    {
      id: 'clean',
      label: 'Clean Browser',
      browser: 'chromium',
      detail: 'temporary profile',
    },
    {
      id: 'p1',
      label: 'Testing / QA',
      browser: 'Comet',
      detail: 'daily browser',
    },
    {
      id: 'p2',
      label: 'Testing / QA',
      browser: 'Chrome',
      detail: 'blocked',
      blockedReason: 'Chrome blocks automation of its default profile',
    },
    { id: 'p3', label: '!!!', browser: 'edge', detail: 'empty' },
  ]);
  deepEqual(
    options.map((item) => item.slug),
    ['clean', 'testing-qa', 'testing-qa-chrome', 'profile-4'],
  );
  equal(options[2]?.blockedReason, 'Chrome blocks automation of its default profile');
});

test('isEndpointName matches the documented shape', () => {
  const rows: [string, boolean][] = [
    ['app', true],
    ['a', true],
    ['worker-2', true],
    ['0start', true],
    [`${'a'.repeat(32)}`, true],
    [`${'a'.repeat(33)}`, false],
    ['', false],
    ['-app', false],
    ['App', false],
    ['has_under', false],
  ];
  for (const [name, ok] of rows) equal(isEndpointName(name), ok, name);
});

test('defaultEndpoint prefers the last used open endpoint', () => {
  const endpoints: EndpointOption[] = [
    { name: 'old', state: 'open', eventCount: 3, lastEventAt: 90 },
    { name: 'app', state: 'open', eventCount: 1, lastEventAt: 10 },
    { name: 'closed', state: 'closed', eventCount: 9, lastEventAt: 500 },
  ];
  equal(defaultEndpoint('app', endpoints), 'app');
});

test('defaultEndpoint skips a closed last used and uses the latest lastEventAt', () => {
  const endpoints: EndpointOption[] = [
    { name: 'quiet', state: 'open', eventCount: 1, lastEventAt: null },
    { name: 'mid', state: 'open', eventCount: 2, lastEventAt: 20 },
    { name: 'hot', state: 'open', eventCount: 3, lastEventAt: 40 },
    { name: 'app', state: 'closed', eventCount: 9, lastEventAt: 99 },
  ];
  equal(defaultEndpoint('app', endpoints), 'hot');
  equal(defaultEndpoint(null, endpoints), 'hot');
});

test('defaultEndpoint treats a missing last used as absent', () => {
  const endpoints: EndpointOption[] = [
    { name: 'only', state: 'open', eventCount: 0, lastEventAt: null },
  ];
  equal(defaultEndpoint('gone', endpoints), 'only');
  equal(defaultEndpoint('only', []), null);
  equal(
    defaultEndpoint(null, [{ name: 'x', state: 'closed', eventCount: 1, lastEventAt: 1 }]),
    null,
  );
});

test('normalizeUrl keeps an explicit scheme and picks http for loopback hosts', () => {
  const rows: [string, string][] = [
    ['http://plain.example', 'http://plain.example'],
    ['https://secure.example', 'https://secure.example'],
    ['localhost:5173', 'http://localhost:5173'],
    ['app.localhost/login', 'http://app.localhost/login'],
    ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['0.0.0.0', 'http://0.0.0.0'],
    ['[::1]:8080', 'http://[::1]:8080'],
    ['app.example.com/login', 'https://app.example.com/login'],
  ];
  for (const [input, expected] of rows) equal(normalizeUrl(input), expected, input);
});

test('displayUrl strips the scheme', () => {
  equal(displayUrl('https://localhost:5173/'), 'localhost:5173/');
  equal(displayUrl('HTTP://APP.EXAMPLE.COM'), 'APP.EXAMPLE.COM');
  equal(displayUrl('localhost:5173'), 'localhost:5173');
});

test('isUrlWord and isUrlAttempt cover the grammar table hosts', () => {
  equal(isUrlWord('localhost:5173'), true);
  equal(isUrlWord('app.example.com/login'), true);
  equal(isUrlWord('127.0.0.1'), true);
  equal(isUrlWord('pooling'), false);
  // Dotted words whose last label is not letters-only are names, not hosts.
  equal(isUrlWord('api.v2'), false);
  equal(isUrlWord('v1.2'), false);
  equal(isUrlWord('app.localhost:3000'), true);
  equal(isUrlAttempt('htp://x'), true);
  equal(isUrlAttempt('http:'), true);
  equal(isUrlAttempt('www.'), true);
  equal(isUrlAttempt('pooling'), false);
});
