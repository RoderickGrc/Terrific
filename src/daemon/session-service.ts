import type {
  CaptureResponse,
  MarkRequest,
  MarkResponse,
  SessionView,
  StartSessionRequest,
} from '../core/api.ts';
import { isTerrificError, TerrificError } from '../core/errors.ts';
import type { IngestEvent } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import { defaultSessionName, isEndpointName } from '../core/setup.ts';
import { isString } from '../core/validate.ts';
import type { LaunchOptions } from '../recorder/launch.ts';
import { profileAutomationFailed } from '../recorder/profiles.ts';
import { startRecording } from '../recorder/recording.ts';
import { createSessionStore } from '../store/sessions.ts';
import type { IngestService } from './ingest-service.ts';
import { markLive, screenshotLive, snapshotLive } from './session-actions.ts';
import {
  appendInput,
  ingestInput,
  type LiveSession,
  type ProjectStore,
  recoverInterrupted as recoverStores,
  type SessionStore,
  sessionView,
  tokenFromUrl,
  writeContextFile,
} from './session-live.ts';
import type { StreamHub } from './stream-hub.ts';

export type SessionService = {
  start(projectId: string, request: StartSessionRequest): Promise<SessionView>;
  stop(id: string, name?: string | null): Promise<SessionView>;
  mark(id: string, request: MarkRequest): Promise<MarkResponse>;
  screenshot(id: string): Promise<CaptureResponse>;
  snapshot(id: string): Promise<CaptureResponse>;
  get(id: string): Promise<SessionView>;
  running(): Promise<SessionView[]>;
  isLinked(projectId: string, name: string): boolean;
  onIngest(projectId: string, name: string, event: IngestEvent): Promise<void>;
  recoverInterrupted(): Promise<void>;
  stopAll(): Promise<void>;
  findLive(id: string): {
    record: LiveSession['record'];
    project: LiveSession['project'];
    store: SessionStore;
  } | null;
  applyRecord(id: string, record: LiveSession['record']): void;
  isRecording(id: string): boolean;
};

export function createSessionService(options: {
  projects: ProjectStore;
  ingest: IngestService;
  hub: StreamHub;
  now: () => Date;
  random: RandomSource;
  resolveBrowser: (profile: string) => Promise<LaunchOptions>;
}): SessionService {
  const stores = new Map<string, SessionStore>();
  const lives = new Map<string, LiveSession>();
  const stamp = { now: options.now, random: options.random, hub: options.hub };

  async function storeFor(project: LiveSession['project']): Promise<SessionStore> {
    const cached = stores.get(project.id);
    if (cached !== undefined) return cached;
    const store = createSessionStore({
      projectDir: project.dir,
      now: options.now,
      random: options.random,
    });
    stores.set(project.id, store);
    return store;
  }

  function viewOf(
    store: SessionStore,
    record: LiveSession['record'],
    project: LiveSession['project'],
  ): Promise<SessionView> {
    return sessionView(store, record, project, options.ingest);
  }

  async function locate(id: string): Promise<{
    live: LiveSession | null;
    store: SessionStore;
    record: LiveSession['record'];
    project: LiveSession['project'];
  }> {
    const live = lives.get(id);
    if (live !== undefined) {
      return { live, store: live.store, record: live.record, project: live.project };
    }
    for (const project of await options.projects.list()) {
      const store = await storeFor(project);
      try {
        const record = await store.get(id);
        return { live: null, store, record, project };
      } catch (error) {
        if (!isTerrificError(error) || error.code !== 'NOT_FOUND') throw error;
      }
    }
    throw new TerrificError('NOT_FOUND', `Session "${id}" was not found.`);
  }

  async function requireLive(id: string): Promise<LiveSession> {
    const found = await locate(id);
    if (found.live === null || found.record.status !== 'recording' || found.live.finishing) {
      throw new TerrificError('USAGE', 'Session is not recording.');
    }
    return found.live;
  }

  async function finalize(
    live: LiveSession,
    name: string | null | undefined,
    browserClosed: boolean,
  ): Promise<SessionView> {
    live.finishing = true;
    if (isString(name)) live.record = await live.store.update(live.record.id, { name });
    if (browserClosed) {
      await appendInput(live, { kind: 'lifecycle', state: 'browser-closed' }, stamp);
    }
    await appendInput(live, { kind: 'lifecycle', state: 'stopped' }, stamp);
    if (live.recording !== null) {
      try {
        await live.recording.stop();
      } catch {
        // The tester may already have closed the window.
      }
      live.recording = null;
    }
    live.record = await live.store.update(live.record.id, {
      status: 'stopped',
      stoppedAt: options.now().toISOString(),
    });
    await writeContextFile(live);
    lives.delete(live.record.id);
    return viewOf(live.store, live.record, live.project);
  }

  async function start(projectId: string, request: StartSessionRequest): Promise<SessionView> {
    const { setup } = request;
    if (setup.endpoint !== null && !isEndpointName(setup.endpoint)) {
      throw new TerrificError('USAGE', 'setup.endpoint is not a valid endpoint name.');
    }
    const project = await options.projects.get(projectId);
    const store = await storeFor(project);
    let endpointRef: { name: string; token: string } | null = null;
    if (setup.endpoint !== null) {
      const opened = await options.ingest.up(projectId, setup.endpoint);
      endpointRef = { name: opened.name, token: tokenFromUrl(opened.url) };
    }
    const launch =
      setup.target === 'browser' ? await options.resolveBrowser(setup.profile) : undefined;
    const created = await store.create({
      name: request.name ?? defaultSessionName(setup, options.now()),
      setup,
      endpoint: endpointRef,
      projectId,
    });
    const live: LiveSession = {
      record: created.record,
      project,
      store,
      startMs: Date.parse(created.record.startedAt),
      nextSeq: 0,
      endpointName: endpointRef === null ? null : endpointRef.name,
      recording: null,
      writes: Promise.resolve(),
      finishing: false,
    };
    lives.set(created.record.id, live);
    try {
      await appendInput(live, { kind: 'lifecycle', state: 'started' }, stamp);
      if (launch !== undefined) {
        live.recording = await startRecording({
          browser: launch,
          url: setup.url,
          record: setup.record,
          screenshotsDir: store.paths(created.record.id).screenshotsDir,
          random: options.random,
          onEvent: (input) => {
            void appendInput(live, input, stamp);
          },
          appendEvent: async (input) => ({ id: (await appendInput(live, input, stamp)).id }),
        });
        void live.recording.closed.then((reason) => {
          if (reason === 'browser-closed') void stop(created.record.id, undefined, true);
        });
      }
    } catch (error) {
      if (lives.has(created.record.id)) await stop(created.record.id);
      // A browser's own profile fails when the browser refuses automation; say so instead of a launch error.
      if (launch?.profileDirectory !== undefined) {
        const browser = launch.browserName ?? 'The browser';
        const label = launch.profileLabel ?? setup.profile;
        throw new TerrificError('INTERNAL', profileAutomationFailed(browser, label));
      }
      throw error;
    }
    return viewOf(live.store, live.record, live.project);
  }

  async function stop(
    id: string,
    name?: string | null,
    browserClosed = false,
  ): Promise<SessionView> {
    const found = await locate(id);
    if (found.live === null || found.record.status !== 'recording') {
      return viewOf(found.store, found.record, found.project);
    }
    if (found.live.finishing) {
      await found.live.writes;
      return viewOf(found.live.store, found.live.record, found.live.project);
    }
    return finalize(found.live, name, browserClosed);
  }

  async function mark(id: string, request: MarkRequest): Promise<MarkResponse> {
    return markLive(await requireLive(id), request, stamp);
  }

  async function screenshot(id: string): Promise<CaptureResponse> {
    return screenshotLive(await requireLive(id));
  }

  async function snapshot(id: string): Promise<CaptureResponse> {
    return snapshotLive(await requireLive(id));
  }

  async function get(id: string): Promise<SessionView> {
    const found = await locate(id);
    const record = found.live === null ? found.record : found.live.record;
    return viewOf(found.store, record, found.project);
  }

  async function running(): Promise<SessionView[]> {
    return Promise.all(
      [...lives.values()].map((live) => viewOf(live.store, live.record, live.project)),
    );
  }

  function isLinked(projectId: string, name: string): boolean {
    for (const live of lives.values()) {
      if (live.project.id === projectId && live.endpointName === name) return true;
    }
    return false;
  }

  async function onIngest(projectId: string, name: string, event: IngestEvent): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const live of lives.values()) {
      if (live.project.id === projectId && live.endpointName === name && !live.finishing) {
        jobs.push(appendInput(live, ingestInput(event), stamp));
      }
    }
    await Promise.all(jobs);
  }

  async function recoverInterrupted(): Promise<void> {
    await recoverStores(options.projects, storeFor, options.now, options.random);
  }

  async function stopAll(): Promise<void> {
    for (const id of [...lives.keys()]) await stop(id);
  }

  function findLive(id: string): {
    record: LiveSession['record'];
    project: LiveSession['project'];
    store: SessionStore;
  } | null {
    const live = lives.get(id);
    if (live === undefined) return null;
    return { record: live.record, project: live.project, store: live.store };
  }

  function applyRecord(id: string, record: LiveSession['record']): void {
    const live = lives.get(id);
    if (live !== undefined) live.record = record;
  }

  function isRecording(id: string): boolean {
    const live = lives.get(id);
    return live !== undefined && live.record.status === 'recording' && !live.finishing;
  }

  return {
    start,
    stop,
    mark,
    screenshot,
    snapshot,
    get,
    running,
    isLinked,
    onIngest,
    recoverInterrupted,
    stopAll,
    findLive,
    applyRecord,
    isRecording,
  };
}
