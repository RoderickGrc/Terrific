import { match } from 'node:assert/strict';
import { test } from 'node:test';
import { TerrificError } from '../core/errors.ts';
import { resolveBrowserProfile } from './resolve-browser.ts';

test('resolveBrowserProfile rejects an unknown slug with a USAGE message', () => {
  try {
    resolveBrowserProfile('nope', true);
    throw new Error('expected USAGE');
  } catch (error) {
    if (!(error instanceof TerrificError)) throw error;
    match(error.code, /USAGE/);
    match(
      error.message,
      /No browser profile called "nope"\. Run terrific-cli profiles to list them\./,
    );
  }
});
