import { isRecord, isString } from './validate.ts';

/**
 * Profiles terrific owns, kept under `<data root>/profiles/<name>`.
 *
 * - `persistent` keeps everything the browser writes, like a normal browser profile.
 * - `snapshot` starts every session from a saved state (cookies, localStorage, IndexedDB) and drops what the session changes.
 */
export const PROFILE_MODES = ['persistent', 'snapshot'] as const;
export type ProfileMode = (typeof PROFILE_MODES)[number];

export const BROWSER_IDS = ['chrome', 'edge', 'chromium', 'comet'] as const;
export type BrowserId = (typeof BROWSER_IDS)[number];

export type ProfileRecord = {
  version: 1;
  name: string;
  mode: ProfileMode;
  browser: BrowserId;
  /** Page opened by `terrific profiles open` when no URL is given; empty for a blank tab. */
  url: string;
  createdAt: string;
  /** When a snapshot profile last saved its state; always null for persistent profiles. */
  savedAt: string | null;
};

const PROFILE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isProfileName(name: string): boolean {
  return PROFILE_NAME.test(name) && name !== 'clean';
}

export function isProfileMode(value: unknown): value is ProfileMode {
  return PROFILE_MODES.some((mode) => mode === value);
}

export function isBrowserId(value: unknown): value is BrowserId {
  return BROWSER_IDS.some((id) => id === value);
}

export function isProfileRecord(value: unknown): value is ProfileRecord {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isString(value.name) &&
    isProfileMode(value.mode) &&
    isBrowserId(value.browser) &&
    isString(value.url) &&
    isString(value.createdAt) &&
    (value.savedAt === null || isString(value.savedAt))
  );
}
