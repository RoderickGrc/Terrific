export type ComposerScreenshotResult = {
  file: string;
  width: number;
  height: number;
  preview: string | null;
  label: string;
};

export type ComposerSnapshotResult = {
  id: string | null;
  title: string;
  wordCount: number;
  excerpt: string;
  label: string;
};

export type ComposerSubmitResult = {
  id: string | null;
};

export type ComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'element'; selector: string; name: string; tag: string }
  | { type: 'screenshot'; label: string; file: string; width: number; height: number }
  | {
      type: 'snapshot';
      label: string;
      id: string | null;
      title: string;
      wordCount: number;
      excerpt: string;
    };

export type ComposerDraft = {
  open: boolean;
  position: { left: number; top: number } | null;
  moved: boolean;
  segments: ComposerSegment[];
};

export type ComposerDraftWithPreviews = Omit<ComposerDraft, 'segments'> & {
  segments: (ComposerSegment & { preview?: string | null })[];
};

export type ComposerLoadDraftResult = {
  draft: ComposerDraftWithPreviews | null;
};

export type ComposerSaveDraftResult = {
  ok: true;
};

export type ComposerBridgeDeps = {
  screenshot: () => Promise<ComposerScreenshotResult>;
  snapshot: () => Promise<ComposerSnapshotResult>;
  submit: (kind: 'note' | 'bug', text: string | null) => Promise<ComposerSubmitResult>;
  loadDraft: () => Promise<ComposerLoadDraftResult>;
  saveDraft: (draft: ComposerDraft | null) => Promise<void>;
};

const MAX_TEXT = 20_000;
const MAX_SEGMENTS = 200;
const MAX_STRING = 2_000;
const FILE_RE = /^screenshots\/ss_[A-Za-z0-9_-]+\.png$/;
const TAG_RE = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(): never {
  throw new Error('Unsupported composer request.');
}

function requireString(value: unknown, max = MAX_STRING): string {
  if (typeof value !== 'string' || value.length > max) unsupported();
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) unsupported();
  return value;
}

function parseSegment(value: unknown): ComposerSegment {
  if (!isRecord(value)) unsupported();
  const type = value.type;
  if (type === 'text') {
    if (typeof value.text !== 'string') unsupported();
    return { type: 'text', text: value.text };
  }
  if (type === 'element') {
    const tag = requireString(value.tag);
    if (!TAG_RE.test(tag)) unsupported();
    return {
      type: 'element',
      selector: requireString(value.selector),
      name: requireString(value.name),
      tag,
    };
  }
  if (type === 'screenshot') {
    const file = requireString(value.file);
    if (!FILE_RE.test(file)) unsupported();
    return {
      type: 'screenshot',
      label: requireString(value.label),
      file,
      width: requireFiniteNumber(value.width),
      height: requireFiniteNumber(value.height),
    };
  }
  if (type === 'snapshot') {
    const id = value.id;
    if (!(id === null || typeof id === 'string')) unsupported();
    if (typeof id === 'string' && id.length > MAX_STRING) unsupported();
    return {
      type: 'snapshot',
      label: requireString(value.label),
      id,
      title: requireString(value.title),
      wordCount: requireFiniteNumber(value.wordCount),
      excerpt: requireString(value.excerpt),
    };
  }
  unsupported();
}

function draftHasContent(draft: ComposerDraft): boolean {
  for (const segment of draft.segments) {
    if (segment.type === 'text') {
      if (segment.text.trim() !== '') return true;
      continue;
    }
    return true;
  }
  return false;
}

export function parseComposerDraft(value: unknown): ComposerDraft {
  if (!isRecord(value)) unsupported();
  if (typeof value.open !== 'boolean') unsupported();
  if (typeof value.moved !== 'boolean') unsupported();

  let position: ComposerDraft['position'];
  if (value.position === null) {
    position = null;
  } else if (isRecord(value.position)) {
    position = {
      left: requireFiniteNumber(value.position.left),
      top: requireFiniteNumber(value.position.top),
    };
  } else {
    unsupported();
  }

  if (!Array.isArray(value.segments)) unsupported();
  if (value.segments.length > MAX_SEGMENTS) unsupported();

  const segments = value.segments.map(parseSegment);
  let textChars = 0;
  for (const segment of segments) {
    if (segment.type === 'text') textChars += segment.text.length;
  }
  if (textChars > MAX_TEXT) {
    throw new Error('Note is too long.');
  }

  return {
    open: value.open,
    position,
    moved: value.moved,
    segments,
  };
}

export async function handleComposerRequest(
  op: unknown,
  payload: unknown,
  deps: ComposerBridgeDeps,
): Promise<
  | ComposerScreenshotResult
  | ComposerSnapshotResult
  | ComposerSubmitResult
  | ComposerLoadDraftResult
  | ComposerSaveDraftResult
> {
  if (op === 'screenshot') return deps.screenshot();
  if (op === 'snapshot') return deps.snapshot();
  if (op === 'loadDraft') return deps.loadDraft();
  if (op === 'saveDraft') {
    const draft = parseComposerDraft(payload);
    await deps.saveDraft(!draftHasContent(draft) && !draft.open ? null : draft);
    return { ok: true };
  }
  if (op !== 'submit') unsupported();

  if (!isRecord(payload)) unsupported();
  const kind = payload.kind;
  const text = payload.text;
  if (kind !== 'note' && kind !== 'bug') unsupported();
  if (!(text === null || typeof text === 'string')) unsupported();

  if (typeof text === 'string' && text.length > MAX_TEXT) {
    throw new Error(kind === 'note' ? 'Note is too long.' : 'Bug is too long.');
  }

  if (kind === 'note') {
    if (text === null || text.trim() === '') {
      throw new Error('Note text is required.');
    }
    const result = await deps.submit('note', text);
    await deps.saveDraft(null);
    return result;
  }

  const stored = text === null || text.trim() === '' ? null : text;
  const result = await deps.submit('bug', stored);
  await deps.saveDraft(null);
  return result;
}
