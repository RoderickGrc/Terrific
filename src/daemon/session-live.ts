import { writeFile } from 'node:fs/promises';
import type { SessionView } from '../core/api.ts';
import { renderContext } from '../core/context-export.ts';
import { isTerrificError, TerrificError } from '../core/errors.ts';
import type { EventInput, IngestEvent, LifecycleEvent, TerrificEvent } from '../core/events.ts';
import { newEventId, type RandomSource } from '../core/ids.ts';
import type { SessionRecord } from '../core/session.ts';
import { toSummaryInfo } from '../core/session.ts';
import { copySetup } from '../core/setup.ts';
import type { Recording } from '../recorder/recording.ts';
import type { createProjectStore, ProjectInfo } from '../store/projects.ts';
import type { createSessionStore } from '../store/sessions.ts';
import type { IngestService } from './ingest-service.ts';
import { type StreamHub, sessionTopic } from './stream-hub.ts';

export type SessionStore = ReturnType<typeof createSessionStore>;
export type ProjectStore = ReturnType<typeof createProjectStore>;

export type LiveSession = {
  record: SessionRecord;
  project: ProjectInfo;
  store: SessionStore;
  startMs: number;
  nextSeq: number;
  endpointName: string | null;
  recording: Recording | null;
  writes: Promise<void>;
  finishing: boolean;
};

export function tokenFromUrl(url: string): string {
  const path = new URL(url).pathname;
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

export function ingestInput(event: IngestEvent): EventInput {
  const input: Omit<IngestEvent, 'id' | 'seq' | 'at' | 't'> = {
    kind: 'ingest',
    endpoint: event.endpoint,
    message: event.message,
    level: event.level,
  };
  if (event.source !== undefined) input.source = event.source;
  if (event.diagnosticSlug !== undefined) input.diagnosticSlug = event.diagnosticSlug;
  if (event.clientTime !== undefined) input.clientTime = event.clientTime;
  if (Object.hasOwn(event, 'data')) input.data = event.data;
  return input;
}

export function enqueue<T>(live: LiveSession, work: () => Promise<T>): Promise<T> {
  const run = live.writes.then(work, work);
  live.writes = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function appendInput(
  live: LiveSession,
  input: EventInput,
  deps: { now: () => Date; random: RandomSource; hub: StreamHub },
): Promise<TerrificEvent> {
  return enqueue(live, async () => {
    if (live.finishing && input.kind !== 'lifecycle') {
      throw new TerrificError('USAGE', 'Session is not recording.');
    }
    const now = deps.now();
    const event = {
      ...input,
      id: newEventId(deps.random),
      seq: live.nextSeq,
      at: now.toISOString(),
      t: now.getTime() - live.startMs,
    } as TerrificEvent;
    live.nextSeq += 1;
    await live.store.appendEvents(live.record.id, [event]);
    deps.hub.publish(sessionTopic(live.record.id), event);
    return event;
  });
}

export async function lastOfKind(
  live: LiveSession,
  kind: 'screenshot' | 'snapshot',
  startSeq: number,
): Promise<TerrificEvent> {
  await live.writes;
  const { events } = await live.store.readEvents(live.record.id);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event !== undefined && event.kind === kind && event.seq >= startSeq) return event;
  }
  throw new TerrificError('INTERNAL', `The ${kind} event was not stored.`);
}

export async function writeContextFile(live: LiveSession): Promise<void> {
  await live.writes;
  const { events } = await live.store.readEvents(live.record.id);
  const text = renderContext({
    session: toSummaryInfo(live.record, live.project.cwd),
    events,
  });
  await writeFile(live.store.paths(live.record.id).contextFile, text, 'utf8');
}

export async function sessionView(
  store: SessionStore,
  record: SessionRecord,
  project: ProjectInfo,
  ingest: IngestService,
): Promise<SessionView> {
  const paths = store.paths(record.id);
  let endpoint = null;
  if (record.endpoint !== null) {
    try {
      endpoint = await ingest.get(project.id, record.endpoint.name);
    } catch (error) {
      if (!isTerrificError(error) || error.code !== 'NOT_FOUND') throw error;
    }
  }
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    projectId: project.id,
    projectPath: project.cwd,
    setup: copySetup(record.setup),
    endpoint,
    legacy: false,
    folder: paths.folder,
    files: {
      context: paths.contextFile,
      events: paths.eventsFile,
      screenshots: paths.screenshotsDir,
    },
  };
}

export async function recoverInterrupted(
  projects: ProjectStore,
  storeFor: (project: ProjectInfo) => Promise<SessionStore>,
  now: () => Date,
  random: RandomSource,
): Promise<void> {
  for (const project of await projects.list()) {
    const store = await storeFor(project);
    for (const id of await store.markInterrupted()) {
      const record = await store.get(id);
      const { events } = await store.readEvents(id);
      let nextSeq = 0;
      for (const event of events) {
        if (event.seq >= nextSeq) nextSeq = event.seq + 1;
      }
      const at = now();
      const event: LifecycleEvent = {
        id: newEventId(random),
        seq: nextSeq,
        at: at.toISOString(),
        t: at.getTime() - Date.parse(record.startedAt),
        kind: 'lifecycle',
        state: 'interrupted',
      };
      await store.appendEvents(id, [event]);
    }
  }
}
