import { deepEqual, equal, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ComposerBridgeDeps,
  type ComposerScreenshotResult,
  type ComposerSnapshotResult,
  type ComposerSubmitResult,
  handleComposerRequest,
} from './composer-bridge.ts';

function deps(overrides: Partial<ComposerBridgeDeps> = {}): ComposerBridgeDeps {
  return {
    screenshot: async () => ({
      file: 'screenshots/ss_x.png',
      width: 800,
      height: 600,
      preview: null,
    }),
    snapshot: async () => ({
      id: 'ev_1',
      title: 'Page',
      wordCount: 3,
      excerpt: 'hello world',
    }),
    submit: async () => ({ id: 'ev_2' }),
    ...overrides,
  };
}

test('handleComposerRequest dispatches screenshot', async () => {
  const shot: ComposerScreenshotResult = {
    file: 'screenshots/ss_a.png',
    width: 10,
    height: 20,
    preview: 'data:image/png;base64,xx',
  };
  const result = await handleComposerRequest(
    'screenshot',
    undefined,
    deps({
      screenshot: async () => shot,
    }),
  );
  deepEqual(result, shot);
});

test('handleComposerRequest dispatches snapshot', async () => {
  const snap: ComposerSnapshotResult = {
    id: null,
    title: 'T',
    wordCount: 0,
    excerpt: '',
  };
  const result = await handleComposerRequest(
    'snapshot',
    undefined,
    deps({
      snapshot: async () => snap,
    }),
  );
  deepEqual(result, snap);
});

test('handleComposerRequest submits a note', async () => {
  let seen: { kind: string; text: string | null } | null = null;
  const result = await handleComposerRequest(
    'submit',
    { kind: 'note', text: 'hello' },
    deps({
      submit: async (kind, text) => {
        seen = { kind, text };
        return { id: 'ev_note' } satisfies ComposerSubmitResult;
      },
    }),
  );
  deepEqual(seen, { kind: 'note', text: 'hello' });
  deepEqual(result, { id: 'ev_note' });
});

test('handleComposerRequest requires note text', async () => {
  await rejects(
    () => handleComposerRequest('submit', { kind: 'note', text: null }, deps()),
    (error: unknown) => error instanceof Error && error.message === 'Note text is required.',
  );
  await rejects(
    () => handleComposerRequest('submit', { kind: 'note', text: '   ' }, deps()),
    (error: unknown) => error instanceof Error && error.message === 'Note text is required.',
  );
});

test('handleComposerRequest stores blank bug text as null', async () => {
  let seen: string | null | undefined;
  await handleComposerRequest(
    'submit',
    { kind: 'bug', text: '  ' },
    deps({
      submit: async (_kind, text) => {
        seen = text;
        return { id: null };
      },
    }),
  );
  equal(seen, null);

  await handleComposerRequest(
    'submit',
    { kind: 'bug', text: null },
    deps({
      submit: async (_kind, text) => {
        seen = text;
        return { id: null };
      },
    }),
  );
  equal(seen, null);
});

test('handleComposerRequest rejects text longer than 20000 characters', async () => {
  const long = 'x'.repeat(20_001);
  await rejects(
    () => handleComposerRequest('submit', { kind: 'note', text: long }, deps()),
    (error: unknown) => error instanceof Error && error.message === 'Note is too long.',
  );
  await rejects(
    () => handleComposerRequest('submit', { kind: 'bug', text: long }, deps()),
    (error: unknown) => error instanceof Error && error.message === 'Bug is too long.',
  );
});

test('handleComposerRequest rejects unknown ops and malformed payloads', async () => {
  const message = (error: unknown) =>
    error instanceof Error && error.message === 'Unsupported composer request.';
  await rejects(() => handleComposerRequest('zoom', undefined, deps()), message);
  await rejects(() => handleComposerRequest('submit', null, deps()), message);
  await rejects(
    () => handleComposerRequest('submit', { kind: 'flag', text: 'x' }, deps()),
    message,
  );
  await rejects(() => handleComposerRequest('submit', { kind: 'note', text: 1 }, deps()), message);
  await rejects(() => handleComposerRequest('submit', { kind: 'bug' }, deps()), message);
});
