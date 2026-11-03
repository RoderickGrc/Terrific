import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import {
  approxTokens,
  formatBytes,
  formatDuration,
  formatOffset,
  formatTokens,
  parseOffset,
  pluralize,
  truncateMiddle,
} from './format.ts';

test('formatOffset uses mm:ss.d and switches to hours after 1h', () => {
  equal(formatOffset(0), '00:00.0');
  equal(formatOffset(-50), '00:00.0');
  equal(formatOffset(1234), '00:01.2');
  equal(formatOffset(59_900), '00:59.9');
  equal(formatOffset(3_600_000), '01:00:00.0');
  equal(formatOffset(3_661_200), '01:01:01.2');
});

test('parseOffset accepts the documented forms and rejects bad input', () => {
  equal(parseOffset('01:02'), 62_000);
  equal(parseOffset('01:02.3'), 62_300);
  equal(parseOffset('01:02:03'), 3_723_000);
  equal(parseOffset('01:02:03.4'), 3_723_400);
  equal(parseOffset('99:00'), null);
  equal(parseOffset('01:60'), null);
  equal(parseOffset('01:02:60'), null);
  equal(parseOffset('1:2'), null);
  equal(parseOffset('nope'), null);
  equal(parseOffset(''), null);
});

test('formatDuration uses seconds, then minutes, then hours', () => {
  equal(formatDuration(0), '0s');
  equal(formatDuration(45_000), '45s');
  equal(formatDuration(185_000), '3m 05s');
  equal(formatDuration(3_720_000), '1h 02m');
});

test('formatBytes uses 1024 and one decimal from KB up', () => {
  equal(formatBytes(812), '812 B');
  equal(formatBytes(14.2 * 1024), '14.2 KB');
  equal(formatBytes(1.3 * 1024 * 1024), '1.3 MB');
});

test('approxTokens is bytes/4 rounded and formatTokens uses the k form', () => {
  equal(approxTokens(14_400), 3600);
  equal(approxTokens(10), 3);
  equal(formatTokens(3600), '~3.6k tokens');
  equal(formatTokens(0), '~0.0k tokens');
});

test('pluralize switches on count and accepts an explicit plural', () => {
  equal(pluralize(1, 'bug'), '1 bug');
  equal(pluralize(2, 'bug'), '2 bugs');
  equal(pluralize(3, 'entry', 'entries'), '3 entries');
});

test('truncateMiddle keeps both ends and an ellipsis', () => {
  equal(truncateMiddle('short', 10), 'short');
  equal(truncateMiddle('abcdefghij', 7), 'abc…hij');
  equal(truncateMiddle('abcd', 1), '…');
  equal(truncateMiddle('abcd', 0), '');
});
