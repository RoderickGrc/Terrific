import { deepEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { startArgvTokens } from './start-tokens.ts';

test('startArgvTokens drops the command name and --json only', () => {
  deepEqual(
    startArgvTokens([
      'node',
      'terrific-cli',
      'start',
      'localhost:5173',
      'x y',
      '@clean',
      '#app',
      '--no-console',
      '--json',
    ]),
    ['localhost:5173', 'x y', '@clean', '#app', '--no-console'],
  );
  deepEqual(startArgvTokens(['node', 'terrific-cli', '--json', 'start', '@nope']), ['@nope']);
});
