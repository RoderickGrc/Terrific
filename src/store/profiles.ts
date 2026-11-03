import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import {
  type BrowserId,
  isProfileName,
  isProfileRecord,
  type ProfileMode,
  type ProfileRecord,
} from '../core/profiles.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

export type ProfilePaths = {
  folder: string;
  profileFile: string;
  /** User data directory of a persistent profile. */
  browserDir: string;
  /** Saved Playwright storage state of a snapshot profile. Holds cookies: never print it. */
  stateFile: string;
};

export type NewProfile = {
  name: string;
  mode: ProfileMode;
  browser: BrowserId;
  url: string;
};

function isErrno(error: unknown, codes: readonly string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}

// Windows reports a folder a running browser still holds as EBUSY or EPERM.
const IN_USE = ['EBUSY', 'EPERM', 'EACCES'] as const;

export function requireProfileName(name: string): void {
  if (!isProfileName(name)) {
    throw new TerrificError(
      'USAGE',
      'Profile names use lowercase letters, digits and hyphens, up to 32 characters, and cannot be "clean".',
    );
  }
}

export function createProfileStore(options: { dir: string; now: () => Date }) {
  function paths(name: string): ProfilePaths {
    const folder = join(options.dir, name);
    return {
      folder,
      profileFile: join(folder, 'profile.json'),
      browserDir: join(folder, 'browser'),
      stateFile: join(folder, 'state.json'),
    };
  }

  async function get(name: string): Promise<ProfileRecord | null> {
    if (!isProfileName(name)) return null;
    return readJsonFile(paths(name).profileFile, isProfileRecord);
  }

  async function load(name: string): Promise<ProfileRecord> {
    const record = await get(name);
    if (record === null) {
      throw new TerrificError(
        'NOT_FOUND',
        `No profile called "${name}". Run terrific profiles to list them.`,
      );
    }
    return record;
  }

  async function list(): Promise<ProfileRecord[]> {
    let names: string[];
    try {
      names = await readdir(options.dir);
    } catch (error) {
      if (isErrno(error, ['ENOENT'])) return [];
      throw error;
    }
    const records: ProfileRecord[] = [];
    for (const name of names.sort()) {
      try {
        const record = await get(name);
        if (record !== null && record.name === name) records.push(record);
      } catch {
        // A damaged profile.json hides that profile instead of breaking the whole list.
      }
    }
    return records;
  }

  async function create(input: NewProfile): Promise<ProfileRecord> {
    requireProfileName(input.name);
    if ((await get(input.name)) !== null) {
      throw new TerrificError('CONFLICT', `A profile called "${input.name}" already exists.`);
    }
    const record: ProfileRecord = {
      version: 1,
      name: input.name,
      mode: input.mode,
      browser: input.browser,
      url: input.url,
      createdAt: options.now().toISOString(),
      savedAt: null,
    };
    await writeJsonFile(paths(input.name).profileFile, record);
    return record;
  }

  async function update(
    name: string,
    patch: Partial<Pick<ProfileRecord, 'url' | 'savedAt'>>,
  ): Promise<ProfileRecord> {
    const record = { ...(await load(name)), ...patch };
    await writeJsonFile(paths(name).profileFile, record);
    return record;
  }

  async function renameProfile(name: string, next: string): Promise<ProfileRecord> {
    requireProfileName(next);
    const record = await load(name);
    if (name === next) return record;
    if ((await get(next)) !== null) {
      throw new TerrificError('CONFLICT', `A profile called "${next}" already exists.`);
    }
    try {
      await rename(paths(name).folder, paths(next).folder);
    } catch (error) {
      if (isErrno(error, IN_USE)) throw inUse(name);
      throw error;
    }
    const renamed = { ...record, name: next };
    await writeJsonFile(paths(next).profileFile, renamed);
    return renamed;
  }

  async function remove(name: string): Promise<void> {
    await load(name);
    try {
      await rm(paths(name).folder, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      if (isErrno(error, IN_USE)) throw inUse(name);
      throw error;
    }
  }

  async function writeState(name: string, state: string): Promise<ProfileRecord> {
    await writeFile(paths(name).stateFile, state, { encoding: 'utf8', mode: 0o600 });
    return update(name, { savedAt: options.now().toISOString() });
  }

  return { paths, get, load, list, create, update, rename: renameProfile, remove, writeState };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;

function inUse(name: string): TerrificError {
  return new TerrificError(
    'CONFLICT',
    `The profile "${name}" is in use. Stop the session or close the browser that uses it first.`,
  );
}
