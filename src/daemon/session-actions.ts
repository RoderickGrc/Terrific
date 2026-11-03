import type { CaptureResponse, MarkRequest, MarkResponse } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import type { RandomSource } from '../core/ids.ts';
import { appendInput, type LiveSession, lastOfKind } from './session-live.ts';
import type { StreamHub } from './stream-hub.ts';

export type Stamp = {
  now: () => Date;
  random: RandomSource;
  hub: StreamHub;
};

export async function markLive(
  live: LiveSession,
  request: MarkRequest,
  stamp: Stamp,
): Promise<MarkResponse> {
  const author = request.author ?? 'tester';
  if (request.kind === 'note') {
    if (request.text === null || request.text.trim() === '') {
      throw new TerrificError('USAGE', 'Note text is required.');
    }
    const event = await appendInput(live, { kind: 'note', text: request.text, author }, stamp);
    return { id: event.id, t: event.t };
  }
  const text = request.text === null || request.text.trim() === '' ? null : request.text;
  const event = await appendInput(live, { kind: request.kind, text, author }, stamp);
  return { id: event.id, t: event.t };
}

export async function screenshotLive(live: LiveSession): Promise<CaptureResponse> {
  if (live.recording === null) {
    throw new TerrificError('USAGE', 'This session has no browser.');
  }
  const startSeq = live.nextSeq;
  const file = await live.recording.screenshot();
  return { event: await lastOfKind(live, 'screenshot', startSeq), file };
}

export async function snapshotLive(live: LiveSession): Promise<CaptureResponse> {
  if (live.recording === null) {
    throw new TerrificError('USAGE', 'This session has no browser.');
  }
  const startSeq = live.nextSeq;
  await live.recording.snapshot();
  return { event: await lastOfKind(live, 'snapshot', startSeq) };
}
