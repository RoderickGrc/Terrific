import type { DaemonClient } from '../../src/client/daemon-client.ts';
import type { SseMessage } from '../../src/client/sse.ts';
import type {
  EndpointView,
  ProfileView,
  ProjectSettingsView,
  ProjectView,
  SessionDetail,
  SessionListItem,
  SessionView,
} from '../../src/core/api.ts';
import { TerrificError } from '../../src/core/errors.ts';
import type { EventInput, TerrificEvent } from '../../src/core/events.ts';
import { sessionStats, verdictLine } from '../../src/core/stats.ts';

const START = Date.parse('2026-03-02T10:00:00.000Z');

export const PROJECT: ProjectView = {
  id: 'p1a2b3c4',
  cwd: '/work/acme-shop',
  createdAt: '2026-03-01T09:00:00.000Z',
  lastOpenedAt: '2026-03-02T09:59:00.000Z',
};

export const PROFILES: ProfileView[] = [
  {
    slug: 'clean',
    label: 'Clean browser',
    detail: 'temporary profile',
    browser: 'Chrome',
    blockedReason: null,
  },
  {
    slug: 'testing',
    label: 'Testing',
    detail: 'Edge · Profile 2',
    browser: 'Edge',
    blockedReason: null,
  },
  {
    slug: 'personal',
    label: 'Personal',
    detail: 'Chrome · Default',
    browser: 'Chrome',
    blockedReason: 'Chrome 136+ blocks automation of its own profiles',
  },
];

function endpoint(name: string, state: 'open' | 'closed', count: number): EndpointView {
  return {
    name,
    url: `http://127.0.0.1:4569/ingest/ing_${name}`,
    state,
    closedReason: state === 'closed' ? 'manual' : null,
    createdAt: '2026-03-01T09:00:00.000Z',
    lastEventAt: count > 0 ? '2026-03-02T09:58:00.000Z' : null,
    eventCount: count,
  };
}

function listItem(
  id: string,
  name: string | null,
  offsetDays: number,
  bugs: number,
): SessionListItem {
  const startedAt = new Date(START - offsetDays * 86_400_000).toISOString();
  return {
    id,
    name,
    status: 'stopped',
    startedAt,
    stoppedAt: new Date(Date.parse(startedAt) + 125_000).toISOString(),
    durationMs: 125_000,
    total: 40 + offsetDays,
    bugs,
    flags: 0,
    errors: 0,
    legacy: false,
    pinned: false,
    marks: bugs > 0 ? [{ t: 30_000, kind: 'bug' }] : [],
  };
}

type Stream = { queue: SseMessage[]; wake: (() => void) | undefined; closed: boolean };

export type FakeDaemon = {
  client: DaemonClient;
  calls: { method: string; args: unknown[] }[];
  /** Appends an event to a session and to its open streams, as the daemon would. */
  emit(sessionId: string, input: EventInput, t: number): TerrificEvent;
};

export function createFakeDaemon(): FakeDaemon {
  const calls: FakeDaemon['calls'] = [];
  let settings: ProjectSettingsView = {
    version: 1,
    lastSetup: {
      target: 'browser',
      url: 'http://localhost:5173/',
      profile: 'clean',
      record: { actions: true, network: true, console: true },
      endpoint: 'app',
    },
    visibility: { action: true, network: true, console: true, ingest: true },
    pinned: [],
  };
  let endpoints = [endpoint('app', 'open', 3), endpoint('worker', 'closed', 0)];
  let sessions = [listItem('s-checkout', 'checkout flow', 1, 2), listItem('s-login', null, 3, 0)];
  const views = new Map<string, SessionView>();
  const contexts = new Set<string>();
  const events = new Map<string, TerrificEvent[]>();
  const streams = new Map<string, Stream[]>();
  let seq = 0;
  let started = 0;
  for (const item of sessions) {
    views.set(item.id, {
      id: item.id,
      name: item.name,
      status: 'stopped',
      startedAt: item.startedAt,
      stoppedAt: item.stoppedAt,
      projectId: PROJECT.id,
      projectPath: PROJECT.cwd,
      setup: settings.lastSetup,
      endpoint: null,
      legacy: false,
      folder: `/data/projects/${PROJECT.id}/sessions/${item.id}`,
      files: { context: 'context.txt', events: 'events.jsonl', screenshots: 'screenshots' },
    });
    events.set(item.id, []);
  }
  emit('s-checkout', { kind: 'bug', text: 'Total ignores the coupon', author: 'tester' }, 30_000);

  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };

  function emit(sessionId: string, input: EventInput, t: number): TerrificEvent {
    seq += 1;
    const event = {
      ...input,
      id: `e${seq}`,
      seq,
      at: new Date(START + t).toISOString(),
      t,
    } as TerrificEvent;
    events.get(sessionId)?.push(event);
    for (const stream of streams.get(sessionId) ?? []) {
      stream.queue.push({ event: 'event', data: JSON.stringify(event) });
      stream.wake?.();
    }
    return event;
  }

  async function* openStream(sessionId: string, signal?: AbortSignal): AsyncGenerator<SseMessage> {
    const stream: Stream = { queue: [], wake: undefined, closed: false };
    const list = streams.get(sessionId) ?? [];
    list.push(stream);
    streams.set(sessionId, list);
    signal?.addEventListener('abort', () => {
      stream.closed = true;
      stream.wake?.();
    });
    while (!stream.closed) {
      const next = stream.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        stream.wake = resolve;
      });
    }
  }

  function detail(id: string): SessionDetail {
    const view = views.get(id);
    if (view === undefined) throw new TerrificError('NOT_FOUND', `Session ${id} not found.`);
    const stats = sessionStats(events.get(id) ?? []);
    return {
      ...view,
      stats,
      verdict: verdictLine(stats),
      contextBytes: contexts.has(id) ? 4096 : null,
    };
  }

  const client: DaemonClient = {
    health: async () => ({ appVersion: '0.0.0', pid: 1, port: 4569, startedAt: '' }),
    listProfiles: async () => PROFILES,
    resolveProject: async () => PROJECT,
    listProjects: async () => [PROJECT],
    listEndpoints: async () => endpoints,
    upEndpoint: async (_p, name) => {
      record('upEndpoint', name);
      const found = endpoints.find((ep) => ep.name === name);
      if (found !== undefined) found.state = 'open';
      else endpoints = [...endpoints, endpoint(name, 'open', 0)];
      return endpoints.find((ep) => ep.name === name) ?? endpoint(name, 'open', 0);
    },
    downEndpoint: async (_p, name) => {
      record('downEndpoint', name);
      endpoints = endpoints.map((ep) =>
        ep.name === name ? { ...ep, state: 'closed', closedReason: 'manual' } : ep,
      );
      return endpoints.find((ep) => ep.name === name) ?? endpoint(name, 'closed', 0);
    },
    renameEndpoint: async (_p, name, next) => {
      record('renameEndpoint', name, next);
      endpoints = endpoints.map((ep) => (ep.name === name ? { ...ep, name: next } : ep));
      return endpoint(next, 'open', 0);
    },
    removeEndpoint: async (_p, name) => {
      record('removeEndpoint', name);
      endpoints = endpoints.filter((ep) => ep.name !== name);
      return { ok: true };
    },
    endpointEvents: async () => [],
    endpointStream: (_p, name, signal) => openStream(`endpoint:${name}`, signal),
    startSession: async (_p, body) => {
      record('startSession', body);
      started += 1;
      const id = `s-new-${started}`;
      const wanted = body.setup.endpoint;
      if (wanted !== null) {
        // Like the daemon: the session's endpoint is created if missing and reopened if closed.
        const found = endpoints.find((e) => e.name === wanted);
        if (found === undefined) endpoints = [...endpoints, endpoint(wanted, 'open', 0)];
        else found.state = 'open';
      }
      const ep = wanted === null ? null : (endpoints.find((e) => e.name === wanted) ?? null);
      const view: SessionView = {
        id,
        name: body.name,
        status: 'recording',
        startedAt: new Date(Date.now()).toISOString(),
        stoppedAt: null,
        projectId: PROJECT.id,
        projectPath: PROJECT.cwd,
        setup: body.setup,
        endpoint: ep,
        legacy: false,
        folder: `/data/projects/${PROJECT.id}/sessions/${id}`,
        files: { context: 'context.txt', events: 'events.jsonl', screenshots: 'screenshots' },
      };
      views.set(id, view);
      events.set(id, []);
      emit(id, { kind: 'lifecycle', state: 'started' }, 0);
      return view;
    },
    stopSession: async (id, body) => {
      record('stopSession', id, body);
      const view = views.get(id);
      if (view === undefined) throw new TerrificError('NOT_FOUND', 'missing');
      const named: SessionView = { ...view, name: body?.name ?? view.name };
      views.set(id, named);
      // Like the daemon: the stop event streams first, the stopped status and context file come later.
      emit(id, { kind: 'lifecycle', state: 'stopped' }, 90_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const stopped: SessionView = {
        ...named,
        status: 'stopped',
        stoppedAt: new Date(Date.parse(view.startedAt) + 90_000).toISOString(),
      };
      views.set(id, stopped);
      contexts.add(id);
      sessions = [{ ...listItem(id, stopped.name, 0, 0), status: 'stopped' }, ...sessions];
      return stopped;
    },
    addMark: async (id, body) => {
      record('addMark', id, body);
      const t = 1000 * (events.get(id)?.length ?? 0);
      const kind = body.kind;
      const author = body.author ?? 'tester';
      const input: EventInput =
        kind === 'note'
          ? { kind, text: body.text ?? '', author }
          : { kind, text: body.text, author };
      const event = emit(id, input, t);
      return { id: event.id, t };
    },
    screenshot: async (id) => {
      record('screenshot', id);
      return {
        event: emit(id, { kind: 'screenshot', file: 'screenshots/shot-1.png', bytes: 2048 }, 5000),
      };
    },
    snapshot: async (id) => {
      record('snapshot', id);
      return {
        event: emit(
          id,
          {
            kind: 'snapshot',
            url: 'http://localhost:5173/',
            title: 'Shop',
            wordCount: 120,
            markdown: '',
          },
          6000,
        ),
      };
    },
    sessionStream: (id, signal) => openStream(id, signal),
    status: async () => ({
      daemon: { appVersion: '0.0.0', pid: 1, port: 4569, startedAt: '' },
      sessions: [...views.values()].filter((v) => v.status === 'recording'),
      endpoints: endpoints.map((ep) => ({ ...ep, projectId: PROJECT.id })),
    }),
    listSessions: async () => sessions,
    listLegacySessions: async () => [
      { ...listItem('legacy-1', 'old import', 400, 0), legacy: true },
    ],
    getSession: async (id) => detail(id),
    queryEvents: async (id) => events.get(id) ?? [],
    writeContext: async (id) => {
      record('writeContext', id);
      return {
        path: `/data/projects/${PROJECT.id}/sessions/${id}/context.txt`,
        bytes: 4096,
        approxTokens: 1024,
      };
    },
    prompt: async (id, kind) => {
      record('prompt', id, kind);
      return { text: `prompt ${kind ?? 'agent'} for ${id}` };
    },
    renameSession: async (id, name) => {
      record('renameSession', id, name);
      const view = views.get(id);
      if (view !== undefined) views.set(id, { ...view, name });
      sessions = sessions.map((s) => (s.id === id ? { ...s, name } : s));
      return views.get(id) ?? ({ id, name } as SessionView);
    },
    deleteSession: async (id) => {
      record('deleteSession', id);
      sessions = sessions.filter((s) => s.id !== id);
      return { ok: true };
    },
    getSettings: async () => settings,
    patchSettings: async (_p, body) => {
      record('patchSettings', body);
      settings = {
        ...settings,
        lastSetup: {
          ...settings.lastSetup,
          ...body.lastSetup,
          record: { ...settings.lastSetup.record, ...body.lastSetup?.record },
        },
        visibility: { ...settings.visibility, ...body.visibility },
        pinned: body.pinned ?? settings.pinned,
      };
      return settings;
    },
    shutdown: async () => ({ ok: true }),
  };

  return { client, calls, emit };
}
