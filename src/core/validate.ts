import type { IngestLevel } from './events.ts';

export type IngestPayload = {
  message: string;
  source?: string;
  diagnosticSlug?: string;
  level: IngestLevel;
  clientTime?: string;
  data?: unknown;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isIngestLevel(value: string): value is IngestLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseLevel(value: unknown): ParseResult<IngestLevel> {
  if (value === undefined) return { ok: true, value: 'info' };
  if (!isString(value)) return { ok: false, error: 'level must be a string.' };
  if (value === 'warning') return { ok: true, value: 'warn' };
  if (value === 'log') return { ok: true, value: 'info' };
  if (isIngestLevel(value)) return { ok: true, value };
  return { ok: false, error: 'level must be debug, info, warn, or error.' };
}

function parseClientTime(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, error: 'timestamp must be a string or number.' };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { ok: false, error: 'timestamp is not a valid time.' };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { ok: false, error: 'timestamp is not a valid time.' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'timestamp is not a valid time.' };
  }
  return { ok: true, value: date.toISOString() };
}

function readOptionalString(
  body: Record<string, unknown>,
  field: string,
): ParseResult<string | undefined> {
  const value = body[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (!isString(value)) return { ok: false, error: `${field} must be a string.` };
  return { ok: true, value };
}

export function parseIngestPayload(body: unknown): ParseResult<IngestPayload> {
  if (!isRecord(body)) return { ok: false, error: 'payload must be an object.' };
  if (!Object.hasOwn(body, 'message')) {
    return { ok: false, error: 'message is required.' };
  }
  if (!isString(body.message) || body.message.trim() === '') {
    return { ok: false, error: 'message must be a non-empty string.' };
  }

  const source = readOptionalString(body, 'source');
  if (!source.ok) return source;
  const diagnosticSlug = readOptionalString(body, 'diagnosticSlug');
  if (!diagnosticSlug.ok) return diagnosticSlug;
  const level = parseLevel(body.level);
  if (!level.ok) return level;
  const clientTime = parseClientTime(body.timestamp);
  if (!clientTime.ok) return clientTime;

  const value: IngestPayload = {
    message: body.message,
    level: level.value,
  };
  if (source.value !== undefined) value.source = source.value;
  if (diagnosticSlug.value !== undefined) value.diagnosticSlug = diagnosticSlug.value;
  if (clientTime.value !== undefined) value.clientTime = clientTime.value;
  if (Object.hasOwn(body, 'data')) value.data = body.data;
  return { ok: true, value };
}
