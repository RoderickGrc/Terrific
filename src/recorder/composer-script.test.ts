import { equal, match } from 'node:assert/strict';
import { test } from 'node:test';
import { COMPOSER_BINDING, composerScript, composerScriptSource } from './composer-script.ts';

test('composerScript serializes as JavaScript suitable for injection', () => {
  const source = composerScript.toString();
  equal(source.includes(': string'), false);
  equal(source.includes(': void'), false);
  const injected = composerScriptSource(COMPOSER_BINDING);
  match(injected, /^\(function composerScript\(bindingName\s*\)/);
  match(injected, /\("__terrificCompose"\)$/);
  for (const forbidden of [
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'fonts.googleapis',
    'style="',
  ]) {
    equal(injected.includes(forbidden), false, `serialized source contains ${forbidden}`);
  }
});
