import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { TerrificError } from '../core/errors.ts';

export type LaunchOptions = {
  executablePath: string;
  userDataDir: string | null;
  profileDirectory?: string;
  headless: boolean;
  browserName?: string;
  profileLabel?: string;
  /** Saved storage state to start from in a fresh context; set for snapshot profiles. A missing file starts empty. */
  storageState?: string;
};

export type LaunchedBrowser = {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
};

function launchMessage(executablePath: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const inUse = /in use|already running|ProcessSingleton|user data directory/i.test(text);
  if (inUse) {
    return `Failed to launch ${executablePath}. Close the browser using this profile first.`;
  }
  return `Failed to launch ${executablePath}.`;
}

const BROWSER_ARGS = ['--no-first-run', '--no-default-browser-check'];

export async function launchBrowser(options: LaunchOptions): Promise<LaunchedBrowser> {
  if (options.storageState !== undefined) return launchFromState(options, options.storageState);
  const ephemeral = options.userDataDir === null;
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'terrific-browser-')));
  const args = [...BROWSER_ARGS];
  if (options.profileDirectory !== undefined && options.profileDirectory !== '') {
    args.push(`--profile-directory=${options.profileDirectory}`);
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: options.executablePath,
      headless: options.headless,
      viewport: null,
      args,
    });
  } catch (error) {
    if (ephemeral) {
      await removeProfileDir(userDataDir);
    }
    throw new TerrificError('INTERNAL', launchMessage(options.executablePath, error));
  }

  const existing = context.pages();
  const page = existing[0] ?? (await context.newPage());
  let closed = false;

  return {
    context,
    page,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await context.close();
      } catch {
        // The user may already have closed the window.
      }
      if (ephemeral) await removeProfileDir(userDataDir);
    },
  };
}

// A regular context, not a persistent one: only regular contexts accept a storage state.
async function launchFromState(
  options: LaunchOptions,
  stateFile: string,
): Promise<LaunchedBrowser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: options.executablePath,
      headless: options.headless,
      args: BROWSER_ARGS,
    });
  } catch (error) {
    throw new TerrificError('INTERNAL', launchMessage(options.executablePath, error));
  }
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: null,
      ...(existsSync(stateFile) ? { storageState: stateFile } : {}),
    });
  } catch (error) {
    await browser.close().catch(() => undefined);
    const text = error instanceof Error ? error.message : String(error);
    throw new TerrificError('INTERNAL', `The saved profile state could not be loaded: ${text}`);
  }
  const page = await context.newPage();
  let closed = false;
  return {
    context,
    page,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await browser.close();
      } catch {
        // The user may already have closed the window.
      }
    },
  };
}

/** Cookies, localStorage and IndexedDB of every origin the context visited, as JSON. */
export async function captureState(context: BrowserContext): Promise<string> {
  return JSON.stringify(await context.storageState({ indexedDB: true }));
}

/** True when a captured state holds at least one cookie or origin. */
export function hasState(state: string): boolean {
  try {
    const value: unknown = JSON.parse(state);
    if (typeof value !== 'object' || value === null) return false;
    const cookies = 'cookies' in value && Array.isArray(value.cookies) ? value.cookies.length : 0;
    const origins = 'origins' in value && Array.isArray(value.origins) ? value.origins.length : 0;
    return cookies + origins > 0;
  } catch {
    return false;
  }
}

// Chrome keeps writing to its profile for a moment after the context closes, which makes
// Windows report EBUSY. Retry briefly, then leave the folder to the OS temp cleanup rather
// than fail a stop over a throwaway directory.
async function removeProfileDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Left in the temp folder; nothing depends on it.
  }
}
