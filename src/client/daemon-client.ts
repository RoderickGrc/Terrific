import {
  type CaptureResponse,
  type ContextRequest,
  type ContextResponse,
  type CreateEndpointRequest,
  type CreateProfileRequest,
  closeEndpointPath,
  closeProfilePath,
  daemonShutdownPath,
  type EndpointView,
  endpointEventsPath,
  endpointPath,
  endpointStreamPath,
  endpointsPath,
  type HealthView,
  healthPath,
  legacySessionsPath,
  type MarkRequest,
  type MarkResponse,
  type OkResponse,
  type OpenProfileRequest,
  openProfilePath,
  type ProfileView,
  type ProjectSettingsView,
  type ProjectView,
  type PromptResponse,
  profilePath,
  profilesPath,
  projectSettingsPath,
  projectsPath,
  type RenameEndpointRequest,
  type RenameProfileRequest,
  type RenameSessionRequest,
  type ResolveProjectRequest,
  renameEndpointPath,
  renameProfilePath,
  resolveProjectPath,
  type SessionDetail,
  type SessionListItem,
  type SessionView,
  type SettingsPatchRequest,
  type StartSessionRequest,
  type StatusView,
  type StopSessionRequest,
  sessionContextPath,
  sessionEventsPath,
  sessionMarksPath,
  sessionPath,
  sessionPromptPath,
  sessionScreenshotPath,
  sessionSnapshotPath,
  sessionStopPath,
  sessionStreamPath,
  sessionsPath,
  statusPath,
} from '../core/api.ts';
import { isErrorCode, TerrificError } from '../core/errors.ts';
import type { TerrificEvent } from '../core/events.ts';
import { isRecord, isString } from '../core/validate.ts';
import { parseSseStream, type SseMessage } from './sse.ts';

export type DaemonClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

export type SessionEventsQuery = {
  type?: string;
  around?: string;
  window?: string;
  at?: string;
  bodies?: boolean;
  limit?: number;
};

export type DaemonClient = {
  health(): Promise<HealthView>;
  listProfiles(): Promise<ProfileView[]>;
  createProfile(body: CreateProfileRequest): Promise<ProfileView>;
  renameProfile(name: string, next: string): Promise<ProfileView>;
  removeProfile(name: string): Promise<OkResponse>;
  openProfile(name: string, url?: string): Promise<ProfileView>;
  closeProfile(name: string): Promise<ProfileView>;
  resolveProject(body: ResolveProjectRequest): Promise<ProjectView>;
  listProjects(): Promise<ProjectView[]>;
  listEndpoints(projectId: string): Promise<EndpointView[]>;
  upEndpoint(projectId: string, name: string): Promise<EndpointView>;
  downEndpoint(projectId: string, name: string): Promise<EndpointView>;
  renameEndpoint(projectId: string, name: string, next: string): Promise<EndpointView>;
  removeEndpoint(projectId: string, name: string): Promise<OkResponse>;
  endpointEvents(projectId: string, name: string, limit?: number): Promise<TerrificEvent[]>;
  endpointStream(projectId: string, name: string, signal?: AbortSignal): AsyncGenerator<SseMessage>;
  startSession(projectId: string, body: StartSessionRequest): Promise<SessionView>;
  stopSession(id: string, body?: StopSessionRequest): Promise<SessionView>;
  addMark(id: string, body: MarkRequest): Promise<MarkResponse>;
  screenshot(id: string): Promise<CaptureResponse>;
  snapshot(id: string): Promise<CaptureResponse>;
  sessionStream(id: string, signal?: AbortSignal): AsyncGenerator<SseMessage>;
  status(): Promise<StatusView>;
  listSessions(projectId: string): Promise<SessionListItem[]>;
  listLegacySessions(): Promise<SessionListItem[]>;
  getSession(id: string): Promise<SessionDetail>;
  queryEvents(id: string, query?: SessionEventsQuery): Promise<TerrificEvent[]>;
  writeContext(id: string, body?: ContextRequest): Promise<ContextResponse>;
  prompt(id: string, kind?: 'agent' | 'bugs' | 'full'): Promise<PromptResponse>;
  renameSession(id: string, name: string): Promise<SessionView>;
  deleteSession(id: string): Promise<OkResponse>;
  getSettings(projectId: string): Promise<ProjectSettingsView>;
  patchSettings(projectId: string, body: SettingsPatchRequest): Promise<ProjectSettingsView>;
  shutdown(): Promise<OkResponse>;
};

const UNREACHABLE = 'Cannot reach the terrific daemon.';

function isApiError(value: unknown): value is { error: { code: string; message: string } } {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    isString(value.error.code) &&
    isString(value.error.message)
  );
}

function joinUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.href;
}

function encodeName(name: string): string {
  return encodeURIComponent(name);
}

export function createDaemonClient(options: DaemonClientOptions): DaemonClient {
  const fetchFn = options.fetch ?? fetch;
  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${options.token}`,
  });

  async function throwHttp(res: Response): Promise<never> {
    let value: unknown;
    try {
      value = await res.json();
    } catch {
      throw new TerrificError('INTERNAL', UNREACHABLE);
    }
    if (isApiError(value) && isErrorCode(value.error.code)) {
      throw new TerrificError(value.error.code, value.error.message);
    }
    throw new TerrificError('INTERNAL', UNREACHABLE);
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response;
    try {
      const init: RequestInit = { method, headers: headers(), signal };
      if (body !== undefined) {
        init.headers = { ...headers(), 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      res = await fetchFn(joinUrl(options.baseUrl, path, query), init);
    } catch (error) {
      if (error instanceof TerrificError) throw error;
      throw new TerrificError('INTERNAL', UNREACHABLE);
    }
    if (res.status < 200 || res.status >= 300) await throwHttp(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }

  async function* openStream(path: string, signal?: AbortSignal): AsyncGenerator<SseMessage> {
    let res: Response;
    try {
      res = await fetchFn(joinUrl(options.baseUrl, path), {
        method: 'GET',
        headers: headers(),
        signal,
      });
    } catch (error) {
      if (error instanceof TerrificError) throw error;
      throw new TerrificError('INTERNAL', UNREACHABLE);
    }
    if (res.status < 200 || res.status >= 300) await throwHttp(res);
    if (res.body === null) throw new TerrificError('INTERNAL', UNREACHABLE);
    yield* parseSseStream(res.body);
  }

  return {
    health: () => request('GET', healthPath()),
    listProfiles: () => request('GET', profilesPath()),
    createProfile: (body) => request('POST', profilesPath(), body),
    renameProfile: (name, next) => {
      const body: RenameProfileRequest = { name: next };
      return request('POST', renameProfilePath(encodeName(name)), body);
    },
    removeProfile: (name) => request('DELETE', profilePath(encodeName(name))),
    openProfile: (name, url) => {
      const body: OpenProfileRequest = url === undefined ? {} : { url };
      return request('POST', openProfilePath(encodeName(name)), body);
    },
    closeProfile: (name) => request('POST', closeProfilePath(encodeName(name))),
    resolveProject: (body) => request('POST', resolveProjectPath(), body),
    listProjects: () => request('GET', projectsPath()),
    listEndpoints: (projectId) => request('GET', endpointsPath(projectId)),
    upEndpoint: (projectId, name) => {
      const body: CreateEndpointRequest = { name };
      return request('POST', endpointsPath(projectId), body);
    },
    downEndpoint: (projectId, name) =>
      request('POST', closeEndpointPath(projectId, encodeName(name))),
    renameEndpoint: (projectId, name, next) => {
      const body: RenameEndpointRequest = { name: next };
      return request('POST', renameEndpointPath(projectId, encodeName(name)), body);
    },
    removeEndpoint: (projectId, name) =>
      request('DELETE', endpointPath(projectId, encodeName(name))),
    endpointEvents: (projectId, name, limit) =>
      request(
        'GET',
        endpointEventsPath(projectId, encodeName(name)),
        undefined,
        limit === undefined ? undefined : { limit: String(limit) },
      ),
    endpointStream: (projectId, name, signal) =>
      openStream(endpointStreamPath(projectId, encodeName(name)), signal),
    startSession: (projectId, body) => request('POST', sessionsPath(projectId), body),
    stopSession: (id, body) => request('POST', sessionStopPath(id), body ?? {}),
    addMark: (id, body) => request('POST', sessionMarksPath(id), body),
    screenshot: (id) => request('POST', sessionScreenshotPath(id)),
    snapshot: (id) => request('POST', sessionSnapshotPath(id)),
    sessionStream: (id, signal) => openStream(sessionStreamPath(id), signal),
    status: () => request('GET', statusPath()),
    listSessions: (projectId) => request('GET', sessionsPath(projectId)),
    listLegacySessions: () => request('GET', legacySessionsPath()),
    getSession: (id) => request('GET', sessionPath(id)),
    queryEvents: (id, query) =>
      request('GET', sessionEventsPath(id), undefined, {
        type: query?.type,
        around: query?.around,
        window: query?.window,
        at: query?.at,
        bodies: query?.bodies === undefined ? undefined : query.bodies ? 'true' : 'false',
        limit: query?.limit === undefined ? undefined : String(query.limit),
      }),
    writeContext: (id, body) => request('POST', sessionContextPath(id), body ?? {}),
    prompt: (id, kind) =>
      request('GET', sessionPromptPath(id), undefined, kind === undefined ? undefined : { kind }),
    renameSession: (id, name) => {
      const body: RenameSessionRequest = { name };
      return request('PATCH', sessionPath(id), body);
    },
    deleteSession: (id) => request('DELETE', sessionPath(id)),
    getSettings: (projectId) => request('GET', projectSettingsPath(projectId)),
    patchSettings: (projectId, body) => request('PATCH', projectSettingsPath(projectId), body),
    shutdown: () => request('POST', daemonShutdownPath()),
  };
}
