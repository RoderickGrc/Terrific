import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { leadingJsonValue } from './legacy-json.ts';

test('leadingJsonValue keeps the first complete value and ignores leftover bytes', () => {
  const rows: Array<[string, string, string | null]> = [
    ['trailing garbage after an array', '[1,2]not-json', '[1,2]'],
    ['trailing partial copy of the same array', '[1,2][1,2', '[1,2]'],
    [
      'brackets and escaped quotes inside strings',
      '["a]b","c\\"d[e","x\\\\","y"]leftover',
      '["a]b","c\\"d[e","x\\\\","y"]',
    ],
    ['garbage-only input', 'not-json {', null],
    ['empty input', '', null],
  ];
  for (const [name, input, expected] of rows) {
    equal(leadingJsonValue(input), expected, name);
  }
});
