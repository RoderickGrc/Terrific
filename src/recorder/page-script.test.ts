import { equal, match } from 'node:assert/strict';
import { test } from 'node:test';
import { BINDING_NAME, pageScript, pageScriptSource } from './page-script.ts';

test('pageScript toString is JavaScript the page can evaluate', () => {
  const source = pageScript.toString();
  // Type annotations are erased before this function exists; leftover
  // ": string" / ": void" would mean the page received TypeScript.
  equal(source.includes(': string'), false);
  equal(source.includes(': void'), false);
  match(pageScriptSource(BINDING_NAME), /^\(function pageScript\(bindingName\s*\)/);
  match(pageScriptSource(BINDING_NAME), new RegExp(`${JSON.stringify(BINDING_NAME)}\\)$`));
});
