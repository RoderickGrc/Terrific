import type { ContextOnly } from './context-export.ts';
import { type ErrorCode, TerrificError } from './errors.ts';
import type { TerrificEvent } from './events.ts';
import type { BrowserId, ProfileMode } from './profiles.ts';
import type { EndpointClosedReason, EndpointState, SessionStatus } from './session.ts';
import type { RecordOptions, SessionSetup } from './setup.ts';
import type { SessionStats } from './stats.ts';

export const DEFAULT_DAEMON_PORT = 4569;

export function parseDaemonPort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_DAEMON_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TerrificError('USAGE', 'TERRIFIC_PORT must be an integer between 0 and 65535.');
  }
  return port;
}
export const MAX_BODY_BYTES = 1024 * 1024;
export const ENDPOINT_IDLE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EVENT_LIMIT = 50;
export const MAX_EVENT_LIMIT = 1000;

export type EndpointView = {
  name: string;
  url: string;
  state: EndpointState;
  closedReason: EndpointClosedReason | null;
  createdAt: string;
  lastEventAt: string | null;
  eventCount: number;
};

export type ProjectView = {
  id: string;
  cwd: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type HealthView = {
  appVersion: string;
  pid: number;
  port: number;
  startedAt: string;
};

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;
  };
};

export type ResolveProjectRequest = {
  cwd: string;
};

export type CreateEndpointRequest = {
  name: string;
};

export type RenameEndpointRequest = {
  name: string;
};

export type OkResponse = {
  ok: true;
};

export type SessionFiles = {
  context: string;
  events: string;
  screenshots: string;
};

export type SessionView = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  stoppedAt: string | null;
  projectId: string;
  projectPath: string;
  setup: SessionSetup;
  endpoint: EndpointView | null;
  legacy: boolean;
  folder: string;
  files: SessionFiles;
};

export type StartSessionRequest = {
  setup: SessionSetup;
  name: string | null;
};

export type StopSessionRequest = {
  name?: string | null;
};

export type MarkRequest = {
  kind: 'note' | 'bug' | 'flag';
  text: string | null;
  author?: 'tester' | 'agent';
};

export type MarkResponse = {
  id: string;
  t: number;
};

export type CaptureResponse = {
  event: TerrificEvent;
  file?: string;
};

export type StatusView = {
  daemon: HealthView;
  sessions: SessionView[];
  endpoints: (EndpointView & { projectId: string })[];
};

export type SessionListMark = {
  t: number;
  kind: 'bug' | 'flag';
};

export type SessionListItem = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number;
  total: number;
  bugs: number;
  flags: number;
  errors: number;
  legacy: boolean;
  pinned: boolean;
  marks: SessionListMark[];
};

export type SessionDetail = SessionView & {
  stats: SessionStats;
  verdict: string;
  contextBytes: number | null;
};

export type ContextResponse = {
  path: string;
  bytes: number;
  approxTokens: number;
};

export type PromptResponse = {
  text: string;
};

export type RenameSessionRequest = {
  name: string;
};

export type ContextRequest = {
  only?: ContextOnly[];
};

/** `clean` is the throwaway profile; the modes are profiles terrific keeps. */
export type ProfileKind = 'clean' | ProfileMode;

export type BrowserView = {
  id: BrowserId;
  name: string;
};

export type ProfileView = {
  slug: string;
  label: string;
  detail: string;
  browser: string;
  blockedReason: string | null;
  kind: ProfileKind;
  /** True while `terrific profiles open` has the profile's browser open for setup. */
  open: boolean;
};

export type CreateProfileRequest = {
  name: string;
  mode: ProfileMode;
  browser?: BrowserId;
  url?: string;
};

export type RenameProfileRequest = {
  name: string;
};

export type OpenProfileRequest = {
  url?: string;
};

export type ProjectSettingsView = {
  version: 1;
  lastSetup: SessionSetup;
  visibility: {
    action: boolean;
    network: boolean;
    console: boolean;
    ingest: boolean;
  };
  pinned: string[];
};

export type SettingsPatchRequest = {
  lastSetup?: Partial<Omit<SessionSetup, 'record'>> & { record?: Partial<RecordOptions> };
  visibility?: Partial<ProjectSettingsView['visibility']>;
  pinned?: string[];
};

export function ingestUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/ingest/${token}`;
}

export function healthPath(): string {
  return '/v1/health';
}

export function profilesPath(): string {
  return '/v1/profiles';
}

export function browsersPath(): string {
  return '/v1/browsers';
}

export function profilePath(name: string): string {
  return `/v1/profiles/${name}`;
}

export function renameProfilePath(name: string): string {
  return `${profilePath(name)}/rename`;
}

export function openProfilePath(name: string): string {
  return `${profilePath(name)}/open`;
}

export function closeProfilePath(name: string): string {
  return `${profilePath(name)}/close`;
}

export function projectsPath(): string {
  return '/v1/projects';
}

export function resolveProjectPath(): string {
  return '/v1/projects/resolve';
}

export function endpointsPath(projectId: string): string {
  return `/v1/projects/${projectId}/endpoints`;
}

export function endpointPath(projectId: string, name: string): string {
  return `/v1/projects/${projectId}/endpoints/${name}`;
}

export function closeEndpointPath(projectId: string, name: string): string {
  return `${endpointPath(projectId, name)}/close`;
}

export function renameEndpointPath(projectId: string, name: string): string {
  return `${endpointPath(projectId, name)}/rename`;
}

export function endpointEventsPath(projectId: string, name: string): string {
  return `${endpointPath(projectId, name)}/events`;
}

export function endpointStreamPath(projectId: string, name: string): string {
  return `${endpointPath(projectId, name)}/stream`;
}

export function ingestPath(token: string): string {
  return `/ingest/${token}`;
}

export function sessionsPath(projectId: string): string {
  return `/v1/projects/${projectId}/sessions`;
}

export function legacySessionsPath(): string {
  return '/v1/legacy/sessions';
}

export function sessionPath(id: string): string {
  return `/v1/sessions/${id}`;
}

export function sessionEventsPath(id: string): string {
  return `/v1/sessions/${id}/events`;
}

export function sessionContextPath(id: string): string {
  return `/v1/sessions/${id}/context`;
}

export function sessionPromptPath(id: string): string {
  return `/v1/sessions/${id}/prompt`;
}

export function projectSettingsPath(projectId: string): string {
  return `/v1/projects/${projectId}/settings`;
}

export function sessionStopPath(id: string): string {
  return `/v1/sessions/${id}/stop`;
}

export function sessionMarksPath(id: string): string {
  return `/v1/sessions/${id}/marks`;
}

export function sessionScreenshotPath(id: string): string {
  return `/v1/sessions/${id}/screenshot`;
}

export function sessionSnapshotPath(id: string): string {
  return `/v1/sessions/${id}/snapshot`;
}

export function sessionStreamPath(id: string): string {
  return `/v1/sessions/${id}/stream`;
}

export function statusPath(): string {
  return '/v1/status';
}

export function daemonShutdownPath(): string {
  return '/v1/daemon/shutdown';
}
