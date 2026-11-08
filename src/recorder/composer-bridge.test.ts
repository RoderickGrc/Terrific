import { deepEqual, equal, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ComposerBridgeDeps,
  type ComposerDraft,
  type ComposerScreenshotResult,
  type ComposerSnapshotResult,
  type ComposerSubmitResult,
  handleComposerRequest,
  parseComposerDraft,
} from './composer-bridge.ts';

function validDraft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    open: true,
    position: { left: 10, top: 20 },
    moved: false,
    segments: [{ type: 'text', text: 'hello' }],
    ...overrides,
  };
}

function deps(overrides: Partial<ComposerBridgeDeps> = {}): ComposerBridgeDeps {
  return {
    screenshot: async () => ({
      file: 'screenshots/ss_x.png',
      width: 800,
      height: 600,
      preview: null,
      label: 'Screenshot 1',
    }),
    snapshot: async () => ({
      id: 'ev_1',
      title: 'Page',
      wordCount: 3,
      excerpt: 'hello world',
      label: 'Snapshot 1',
    }),
    submit: async () => ({ id: 'ev_2' }),
    loadDraft: async () => ({ draft: null }),
    saveDraft: async () => undefined,
    ...overrides,
  };
}

test('handleComposerRequest dispatches screenshot', async () => {
  const shot: ComposerScreenshotResult = {
    file: 'screenshots/ss_a.png',
    width: 10,
    height: 20,
    preview: 'data:image/png;base64,xx',
    label: 'Screenshot 1',
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
    label: 'Snapshot 1',
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

test('parseComposerDraft round-trips a valid draft and drops extra fields', () => {
  const parsed = parseComposerDraft({
    open: true,
    position: { left: 1, top: 2, extra: true },
    moved: true,
    segments: [
      { type: 'text', text: 'a\nb', extra: 1 },
      {
        type: 'element',
        selector: '#x',
        name: 'X',
        tag: 'button',
        extra: true,
      },
      {
        type: 'screenshot',
        label: 'Screenshot 1',
        file: 'screenshots/ss_abc.png',
        width: 100,
        height: 50,
        preview: 'nope',
      },
      {
        type: 'snapshot',
        label: 'Snapshot 1',
        id: 'ev_1',
        title: 'Title',
        wordCount: 4,
        excerpt: 'four words here now',
        extra: 'drop',
      },
    ],
    unused: true,
  });
  deepEqual(parsed, {
    open: true,
    position: { left: 1, top: 2 },
    moved: true,
    segments: [
      { type: 'text', text: 'a\nb' },
      { type: 'element', selector: '#x', name: 'X', tag: 'button' },
      {
        type: 'screenshot',
        label: 'Screenshot 1',
        file: 'screenshots/ss_abc.png',
        width: 100,
        height: 50,
      },
      {
        type: 'snapshot',
        label: 'Snapshot 1',
        id: 'ev_1',
        title: 'Title',
        wordCount: 4,
        excerpt: 'four words here now',
      },
    ],
  });
});

test('parseComposerDraft rejects malformed drafts', () => {
  const message = (error: unknown) =>
    error instanceof Error && error.message === 'Unsupported composer request.';
  const reject = (value: unknown) => {
    try {
      parseComposerDraft(value);
      throw new Error('expected rejection');
    } catch (error) {
      if (!message(error)) throw error;
    }
  };

  reject(null);
  reject([]);
  reject({ open: true, position: null, moved: true });
  reject({ open: 'yes', position: null, moved: false, segments: [] });
  reject({ open: true, position: null, moved: 1, segments: [] });
  reject({ open: true, position: { left: 1 }, moved: false, segments: [] });
  reject({ open: true, position: { left: NaN, top: 1 }, moved: false, segments: [] });
  reject({ open: true, position: { left: 1, top: Infinity }, moved: false, segments: [] });
  reject({ open: true, position: 'x', moved: false, segments: [] });
  reject({ open: true, position: null, moved: false, segments: [{ type: 'text' }] });
  reject({ open: true, position: null, moved: false, segments: [{ type: 'widget' }] });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [
      { type: 'screenshot', label: 'S', file: 'screenshots/../x.png', width: 1, height: 1 },
    ],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [
      {
        type: 'screenshot',
        label: 'S',
        file: '/abs/screenshots/ss_x.png',
        width: 1,
        height: 1,
      },
    ],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [
      { type: 'screenshot', label: 'S', file: 'screenshots/ss_x.jpg', width: 1, height: 1 },
    ],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [{ type: 'element', selector: 'a', name: 'A', tag: 'DIV' }],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [{ type: 'element', selector: 'a', name: 'A', tag: '1div' }],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: Array.from({ length: 201 }, () => ({ type: 'text', text: '' })),
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [
      { type: 'screenshot', label: 'S', file: 'screenshots/ss_x.png', width: NaN, height: 1 },
    ],
  });
  reject({
    open: true,
    position: null,
    moved: false,
    segments: [
      {
        type: 'snapshot',
        label: 'S',
        id: 1,
        title: 'T',
        wordCount: 0,
        excerpt: '',
      },
    ],
  });
});

test('parseComposerDraft rejects total text over 20000 characters', () => {
  try {
    parseComposerDraft({
      open: true,
      position: null,
      moved: false,
      segments: [
        { type: 'text', text: 'x'.repeat(10_000) },
        { type: 'text', text: 'y'.repeat(10_001) },
      ],
    });
    throw new Error('expected rejection');
  } catch (error) {
    equal(error instanceof Error && error.message, 'Note is too long.');
  }
});

test('handleComposerRequest saveDraft stores null for empty closed draft', async () => {
  let stored: ComposerDraft | null | undefined = validDraft();
  const result = await handleComposerRequest(
    'saveDraft',
    {
      open: false,
      position: null,
      moved: false,
      segments: [{ type: 'text', text: '   \n  ' }],
    },
    deps({
      saveDraft: async (draft) => {
        stored = draft;
      },
    }),
  );
  equal(stored, null);
  deepEqual(result, { ok: true });

  await handleComposerRequest(
    'saveDraft',
    {
      open: false,
      position: null,
      moved: false,
      segments: [],
    },
    deps({
      saveDraft: async (draft) => {
        stored = draft;
      },
    }),
  );
  equal(stored, null);

  const openEmpty = validDraft({ open: true, segments: [{ type: 'text', text: '  ' }] });
  await handleComposerRequest(
    'saveDraft',
    openEmpty,
    deps({
      saveDraft: async (draft) => {
        stored = draft;
      },
    }),
  );
  deepEqual(stored, openEmpty);

  const withElement = validDraft({
    open: false,
    segments: [{ type: 'element', selector: '#a', name: 'A', tag: 'a' }],
  });
  await handleComposerRequest(
    'saveDraft',
    withElement,
    deps({
      saveDraft: async (draft) => {
        stored = draft;
      },
    }),
  );
  deepEqual(stored, withElement);
});

test('handleComposerRequest loadDraft passes through deps result', async () => {
  const draft = {
    open: true,
    position: null,
    moved: false,
    segments: [
      {
        type: 'screenshot' as const,
        label: 'Screenshot 1',
        file: 'screenshots/ss_a.png',
        width: 1,
        height: 2,
        preview: 'data:image/png;base64,abc',
      },
    ],
  };
  const result = await handleComposerRequest(
    'loadDraft',
    undefined,
    deps({
      loadDraft: async () => ({ draft }),
    }),
  );
  deepEqual(result, { draft });
});

test('handleComposerRequest clears draft only after successful submit', async () => {
  const saved: Array<ComposerDraft | null> = [];
  await handleComposerRequest(
    'submit',
    { kind: 'note', text: 'ok' },
    deps({
      saveDraft: async (draft) => {
        saved.push(draft);
      },
    }),
  );
  deepEqual(saved, [null]);

  const failed: Array<ComposerDraft | null> = [];
  await rejects(
    () =>
      handleComposerRequest(
        'submit',
        { kind: 'bug', text: 'nope' },
        deps({
          submit: async () => {
            throw new Error('append failed');
          },
          saveDraft: async (draft) => {
            failed.push(draft);
          },
        }),
      ),
    (error: unknown) => error instanceof Error && error.message === 'append failed',
  );
  deepEqual(failed, []);
});

test('parseComposerDraft keeps an element reference and rejects an oversized one', () => {
  const reference =
    '<pointed-section>\n- Selector: `#email`\n- Element: `<input id="email">`\n</pointed-section>';
  const element = { type: 'element', selector: '#email', name: 'Email', tag: 'input' };
  const base = { open: true, position: null, moved: false };
  const parsed = parseComposerDraft({ ...base, segments: [{ ...element, reference }] });
  deepEqual(parsed.segments[0], { ...element, reference });
  const withoutReference = parseComposerDraft({ ...base, segments: [element] });
  deepEqual(withoutReference.segments[0], element);
  let error: unknown;
  try {
    parseComposerDraft({ ...base, segments: [{ ...element, reference: 'x'.repeat(8_001) }] });
  } catch (caught) {
    error = caught;
  }
  equal(error instanceof Error ? error.message : '', 'Unsupported composer request.');
});
