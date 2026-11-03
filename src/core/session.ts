import { EVENT_KINDS, type TerrificEvent } from './events.ts';
import { copySetup, type SessionSetup } from './setup.ts';
import { isRecord, isString } from './validate.ts';

export type SessionStatus = 'recording' | 'stopped' | 'interrupted';

export type SessionSummaryInfo = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  stoppedAt: string | null;
  projectPath: string;
  setup: SessionSetup;
  legacy: boolean;
};

export type SessionEndpointRef = {
  name: string;
  token: string;
};

export type SessionRecord = {
  version: 1;
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  stoppedAt: string | null;
  projectId: string;
  setup: SessionSetup;
  endpoint: SessionEndpointRef | null;
};

export type EndpointState = 'open' | 'closed';
export type EndpointClosedReason = 'manual' | 'idle';

export type EndpointRecord = {
  version: 1;
  name: string;
  token: string;
  state: EndpointState;
  closedReason: EndpointClosedReason | null;
  createdAt: string;
  lastEventAt: string | null;
  eventCount: number;
};

export function toSummaryInfo(record: SessionRecord, projectPath: string): SessionSummaryInfo {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    projectPath,
    setup: copySetup(record.setup),
    legacy: false,
  };
}

export function isSessionStatus(value: unknown): value is SessionStatus {
  return value === 'recording' || value === 'stopped' || value === 'interrupted';
}

function isRecordOptions(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.actions === 'boolean' &&
    typeof value.network === 'boolean' &&
    typeof value.console === 'boolean'
  );
}

export function isSessionSetup(value: unknown): value is SessionSetup {
  return (
    isRecord(value) &&
    (value.target === 'browser' || value.target === 'none') &&
    isString(value.url) &&
    isString(value.profile) &&
    isRecordOptions(value.record) &&
    (value.endpoint === null || isString(value.endpoint))
  );
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isString(value.id) || !isString(value.startedAt) || !isString(value.projectId)) {
    return false;
  }
  if (!(value.name === null || isString(value.name))) return false;
  if (!(value.stoppedAt === null || isString(value.stoppedAt))) return false;
  if (!isSessionStatus(value.status) || !isSessionSetup(value.setup)) return false;
  if (value.endpoint === null) return true;
  return (
    isRecord(value.endpoint) && isString(value.endpoint.name) && isString(value.endpoint.token)
  );
}

export function isEndpointRecord(value: unknown): value is EndpointRecord {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isString(value.name) || !isString(value.token) || !isString(value.createdAt)) return false;
  if (value.state !== 'open' && value.state !== 'closed') return false;
  if (
    value.closedReason !== null &&
    value.closedReason !== 'manual' &&
    value.closedReason !== 'idle'
  ) {
    return false;
  }
  if (!(value.lastEventAt === null || isString(value.lastEventAt))) return false;
  return typeof value.eventCount === 'number' && Number.isFinite(value.eventCount);
}

export function isStoredEvent(value: unknown): value is TerrificEvent {
  if (!isRecord(value)) return false;
  if (!isString(value.id) || !isString(value.at)) return false;
  if (typeof value.seq !== 'number' || !Number.isFinite(value.seq)) return false;
  if (typeof value.t !== 'number' || !Number.isFinite(value.t)) return false;
  for (const kind of EVENT_KINDS) {
    if (value.kind === kind) return true;
  }
  return false;
}
