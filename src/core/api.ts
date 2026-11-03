import type { ErrorCode } from './errors.ts';
import type { EndpointClosedReason, EndpointState } from './session.ts';

export const DEFAULT_DAEMON_PORT = 4569;
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

export function ingestUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/ingest/${token}`;
}

export function healthPath(): string {
  return '/v1/health';
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
