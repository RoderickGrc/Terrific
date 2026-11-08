export type ComposerScreenshotResult = {
  file: string;
  width: number;
  height: number;
  preview: string | null;
};

export type ComposerSnapshotResult = {
  id: string | null;
  title: string;
  wordCount: number;
  excerpt: string;
};

export type ComposerSubmitResult = {
  id: string | null;
};

export type ComposerBridgeDeps = {
  screenshot: () => Promise<ComposerScreenshotResult>;
  snapshot: () => Promise<ComposerSnapshotResult>;
  submit: (kind: 'note' | 'bug', text: string | null) => Promise<ComposerSubmitResult>;
};

const MAX_TEXT = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(): never {
  throw new Error('Unsupported composer request.');
}

export async function handleComposerRequest(
  op: unknown,
  payload: unknown,
  deps: ComposerBridgeDeps,
): Promise<ComposerScreenshotResult | ComposerSnapshotResult | ComposerSubmitResult> {
  if (op === 'screenshot') return deps.screenshot();
  if (op === 'snapshot') return deps.snapshot();
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
    return deps.submit('note', text);
  }

  const stored = text === null || text.trim() === '' ? null : text;
  return deps.submit('bug', stored);
}
