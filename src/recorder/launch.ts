import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright-core';
import { TerrificError } from '../core/errors.ts';

export type LaunchOptions = {
  executablePath: string;
  userDataDir: string | null;
  profileDirectory?: string;
  headless: boolean;
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

export async function launchBrowser(options: LaunchOptions): Promise<LaunchedBrowser> {
  const ephemeral = options.userDataDir === null;
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'terrific-browser-')));
  const args = ['--no-first-run', '--no-default-browser-check'];
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
