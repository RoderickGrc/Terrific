import { ENDPOINT_IDLE_MS, type EndpointView, ingestUrl } from '../core/api.ts';
import { isTerrificError, TerrificError } from '../core/errors.ts';
import type { IngestEvent, TerrificEvent } from '../core/events.ts';
import { newEventId, type RandomSource } from '../core/ids.ts';
import type { EndpointRecord } from '../core/session.ts';
import { parseIngestPayload } from '../core/validate.ts';
import { createEndpointStore } from '../store/endpoints.ts';
import type { createProjectStore } from '../store/projects.ts';
import { endpointTopic, type StreamHub } from './stream-hub.ts';

export type TokenRef = {
  projectId: string;
  name: string;
};

export type IngestHooks = {
  isLinked(projectId: string, name: string): boolean;
  onIngest(projectId: string, name: string, event: IngestEvent): void | Promise<void>;
};

export type IngestService = {
  up(projectId: string, name: string): Promise<EndpointView>;
  down(projectId: string, name: string): Promise<EndpointView>;
  rename(projectId: string, name: string, next: string): Promise<EndpointView>;
  remove(projectId: string, name: string): Promise<void>;
  list(projectId: string): Promise<EndpointView[]>;
  get(projectId: string, name: string): Promise<EndpointView>;
  tail(projectId: string, name: string, limit: number): Promise<TerrificEvent[]>;
  receive(token: string, body: unknown): Promise<void>;
  closeIdle(): Promise<void>;
  findByToken(token: string): Promise<EndpointView | null>;
};

type EndpointStore = ReturnType<typeof createEndpointStore>;
type ProjectStore = ReturnType<typeof createProjectStore>;

export async function createIngestService(options: {
  projects: ProjectStore;
  hub: StreamHub;
  now: () => Date;
  random: RandomSource;
  getPort: () => number;
  hooks: IngestHooks;
}): Promise<IngestService> {
  const stores = new Map<string, EndpointStore>();
  const tokens = new Map<string, TokenRef>();

  function toView(record: EndpointRecord): EndpointView {
    return {
      name: record.name,
      url: ingestUrl(options.getPort(), record.token),
      state: record.state,
      closedReason: record.closedReason,
      createdAt: record.createdAt,
      lastEventAt: record.lastEventAt,
      eventCount: record.eventCount,
    };
  }

  async function storeFor(projectId: string): Promise<EndpointStore> {
    const cached = stores.get(projectId);
    if (cached !== undefined) return cached;
    const project = await options.projects.get(projectId);
    const store = createEndpointStore({
      projectDir: project.dir,
      now: options.now,
      random: options.random,
    });
    stores.set(projectId, store);
    return store;
  }

  async function rebuildIndex(): Promise<void> {
    tokens.clear();
    stores.clear();
    for (const project of await options.projects.list()) {
      const store = await storeFor(project.id);
      for (const record of await store.list()) {
        tokens.set(record.token, { projectId: project.id, name: record.name });
      }
    }
  }

  await rebuildIndex();

  async function up(projectId: string, name: string): Promise<EndpointView> {
    const store = await storeFor(projectId);
    let record: EndpointRecord;
    try {
      record = await store.get(name);
    } catch (error) {
      if (!isTerrificError(error) || error.code !== 'NOT_FOUND') throw error;
      record = await store.create(name);
      tokens.set(record.token, { projectId, name: record.name });
      return toView(record);
    }
    if (record.state === 'closed') record = await store.setState(name, 'open', null);
    return toView(record);
  }

  // A recording session finds its endpoint by name and expects it open, so closing,
  // renaming or deleting it would silently cut the session's ingest feed.
  function assertNotLinked(projectId: string, name: string): void {
    if (options.hooks.isLinked(projectId, name)) {
      throw new TerrificError(
        'CONFLICT',
        `Endpoint "${name}" is linked to a recording session. Stop the session first.`,
      );
    }
  }

  async function down(projectId: string, name: string): Promise<EndpointView> {
    assertNotLinked(projectId, name);
    const store = await storeFor(projectId);
    return toView(await store.setState(name, 'closed', 'manual'));
  }

  async function rename(projectId: string, name: string, next: string): Promise<EndpointView> {
    assertNotLinked(projectId, name);
    const store = await storeFor(projectId);
    const record = await store.rename(name, next);
    tokens.set(record.token, { projectId, name: record.name });
    return toView(record);
  }

  async function remove(projectId: string, name: string): Promise<void> {
    assertNotLinked(projectId, name);
    const store = await storeFor(projectId);
    const record = await store.get(name);
    await store.remove(name);
    tokens.delete(record.token);
  }

  async function list(projectId: string): Promise<EndpointView[]> {
    const store = await storeFor(projectId);
    return (await store.list()).map(toView);
  }

  async function get(projectId: string, name: string): Promise<EndpointView> {
    const store = await storeFor(projectId);
    return toView(await store.get(name));
  }

  async function tail(projectId: string, name: string, limit: number): Promise<TerrificEvent[]> {
    const store = await storeFor(projectId);
    const { events } = await store.readEvents(name, { limit });
    return events;
  }

  async function receive(token: string, body: unknown): Promise<void> {
    const ref = tokens.get(token);
    if (ref === undefined) {
      throw new TerrificError('NOT_FOUND', 'Unknown ingest token.');
    }
    const store = await storeFor(ref.projectId);
    const record = await store.get(ref.name);
    if (record.state === 'closed') {
      throw new TerrificError('ENDPOINT_CLOSED', `Endpoint "${record.name}" is closed.`);
    }
    const parsed = parseIngestPayload(body);
    if (!parsed.ok) throw new TerrificError('INVALID_INPUT', parsed.error);
    const now = options.now();
    const event: IngestEvent = {
      id: newEventId(options.random),
      seq: record.eventCount,
      at: now.toISOString(),
      t: now.getTime() - Date.parse(record.createdAt),
      kind: 'ingest',
      endpoint: record.name,
      message: parsed.value.message,
      level: parsed.value.level,
    };
    if (parsed.value.source !== undefined) event.source = parsed.value.source;
    if (parsed.value.diagnosticSlug !== undefined) {
      event.diagnosticSlug = parsed.value.diagnosticSlug;
    }
    if (parsed.value.clientTime !== undefined) event.clientTime = parsed.value.clientTime;
    if (Object.hasOwn(parsed.value, 'data')) event.data = parsed.value.data;
    await store.appendEvent(record.name, event);
    options.hub.publish(endpointTopic(ref.projectId, record.name), event);
    await options.hooks.onIngest(ref.projectId, record.name, event);
  }

  async function closeIdle(): Promise<void> {
    for (const project of await options.projects.list()) {
      const store = await storeFor(project.id);
      await store.closeIdle(ENDPOINT_IDLE_MS);
    }
  }

  async function findByToken(token: string): Promise<EndpointView | null> {
    const ref = tokens.get(token);
    if (ref === undefined) return null;
    return get(ref.projectId, ref.name);
  }

  return { up, down, rename, remove, list, get, tail, receive, closeIdle, findByToken };
}
