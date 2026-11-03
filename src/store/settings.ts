import { join } from 'node:path';
import type { RecordOptions, SessionSetup, Target } from '../core/setup.ts';
import { isRecord, isString } from '../core/validate.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

export type LogVisibility = {
  action: boolean;
  network: boolean;
  console: boolean;
  ingest: boolean;
};

export type ProjectSettings = {
  version: 1;
  lastSetup: SessionSetup;
  visibility: LogVisibility;
  pinned: string[];
};

export type SettingsPatch = {
  lastSetup?: Partial<Omit<SessionSetup, 'record'>> & { record?: Partial<RecordOptions> };
  visibility?: Partial<LogVisibility>;
  pinned?: string[];
};

const DEFAULT_SETUP: SessionSetup = {
  target: 'browser',
  url: '',
  profile: 'clean',
  record: { actions: true, network: true, console: true },
  endpoint: null,
};

const DEFAULT_VISIBILITY: LogVisibility = {
  action: true,
  network: true,
  console: true,
  ingest: true,
};

export function defaultProjectSettings(): ProjectSettings {
  return {
    version: 1,
    lastSetup: { ...DEFAULT_SETUP, record: { ...DEFAULT_SETUP.record } },
    visibility: { ...DEFAULT_VISIBILITY },
    pinned: [],
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseTarget(value: unknown): Target {
  return value === 'browser' || value === 'none' ? value : DEFAULT_SETUP.target;
}

function parseLastSetup(value: unknown): SessionSetup {
  const body = isRecord(value) ? value : {};
  const record = isRecord(body.record) ? body.record : {};
  return {
    target: parseTarget(body.target),
    url: isString(body.url) ? body.url : DEFAULT_SETUP.url,
    profile: isString(body.profile) ? body.profile : DEFAULT_SETUP.profile,
    record: {
      actions: asBoolean(record.actions, DEFAULT_SETUP.record.actions),
      network: asBoolean(record.network, DEFAULT_SETUP.record.network),
      console: asBoolean(record.console, DEFAULT_SETUP.record.console),
    },
    endpoint:
      isString(body.endpoint) || body.endpoint === null ? body.endpoint : DEFAULT_SETUP.endpoint,
  };
}

function parseVisibility(value: unknown): LogVisibility {
  const body = isRecord(value) ? value : {};
  return {
    action: asBoolean(body.action, DEFAULT_VISIBILITY.action),
    network: asBoolean(body.network, DEFAULT_VISIBILITY.network),
    console: asBoolean(body.console, DEFAULT_VISIBILITY.console),
    ingest: asBoolean(body.ingest, DEFAULT_VISIBILITY.ingest),
  };
}

function parsePinned(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isString(item));
}

function isProjectSettingsFile(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function fromFile(value: Record<string, unknown> | null): ProjectSettings {
  if (value === null) return defaultProjectSettings();
  return {
    version: 1,
    lastSetup: parseLastSetup(value.lastSetup),
    visibility: parseVisibility(value.visibility),
    pinned: parsePinned(value.pinned),
  };
}

export function createSettingsStore(options: { projectDir: string }) {
  const file = join(options.projectDir, 'settings.json');

  async function read(): Promise<ProjectSettings> {
    try {
      const raw = await readJsonFile(file, isProjectSettingsFile);
      return fromFile(raw);
    } catch {
      // Corrupt settings must not block the project; fall back field by field.
      return defaultProjectSettings();
    }
  }

  async function write(patch: SettingsPatch): Promise<ProjectSettings> {
    const current = await read();
    const next: ProjectSettings = {
      version: 1,
      lastSetup: parseLastSetup({
        ...current.lastSetup,
        ...patch.lastSetup,
        record: { ...current.lastSetup.record, ...patch.lastSetup?.record },
      }),
      visibility: parseVisibility({ ...current.visibility, ...patch.visibility }),
      pinned: patch.pinned !== undefined ? parsePinned(patch.pinned) : current.pinned,
    };
    await writeJsonFile(file, next);
    return next;
  }

  return { read, write };
}
