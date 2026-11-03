import type { NetworkEvent, TerrificEvent } from './events.ts';

export type NetworkRequest = {
  requestId: string;
  method: string;
  url: string;
  startT: number;
  endT?: number;
  status?: number;
  durationMs?: number;
  failed: boolean;
  errorText?: string;
  requestBody?: string;
  responseBody?: string;
};

function applyNetworkFields(row: NetworkRequest, event: NetworkEvent): void {
  row.method = event.method;
  row.url = event.url;
  if (event.status !== undefined) row.status = event.status;
  if (event.durationMs !== undefined) row.durationMs = event.durationMs;
  if (event.requestBody !== undefined) row.requestBody = event.requestBody;
  if (event.responseBody !== undefined) row.responseBody = event.responseBody;
  if (event.errorText !== undefined) row.errorText = event.errorText;
}

export function foldNetwork(events: readonly TerrificEvent[]): NetworkRequest[] {
  const rows: NetworkRequest[] = [];
  const byId = new Map<string, NetworkRequest>();

  for (const event of events) {
    if (event.kind !== 'network') continue;
    const existing = byId.get(event.requestId);
    if (!existing) {
      const row: NetworkRequest = {
        requestId: event.requestId,
        method: event.method,
        url: event.url,
        startT: event.t,
        failed: event.phase === 'failed',
      };
      if (event.phase !== 'request') row.endT = event.t;
      applyNetworkFields(row, event);
      byId.set(event.requestId, row);
      rows.push(row);
      continue;
    }
    if (event.phase === 'request') {
      existing.startT = event.t;
    } else {
      existing.endT = event.t;
      if (event.phase === 'failed') existing.failed = true;
    }
    applyNetworkFields(existing, event);
  }

  return rows;
}

export function isFailedRequest(request: NetworkRequest): boolean {
  return request.failed || (request.status !== undefined && request.status >= 400);
}
