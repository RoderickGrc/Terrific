import { existsSync } from 'node:fs';
import { TerrificError } from '../core/errors.ts';
import { findInstalledBrowsers } from '../recorder/browsers.ts';
import type { LaunchOptions } from '../recorder/launch.ts';

const BROWSER_ORDER = ['chrome', 'edge', 'chromium', 'comet'] as const;

export function resolveCleanBrowser(profile: string, headless: boolean): LaunchOptions {
  if (profile !== 'clean') {
    throw new TerrificError('USAGE', 'Browser profiles other than "clean" are not available yet.');
  }
  const found = findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
  for (const id of BROWSER_ORDER) {
    const match = found.find((browser) => browser.id === id);
    if (match !== undefined) {
      return {
        executablePath: match.executablePath,
        userDataDir: null,
        headless,
      };
    }
  }
  throw new TerrificError('INTERNAL', 'No Chromium-based browser found. Install Chrome or Edge.');
}

export function defaultResolveBrowser(profile: string): LaunchOptions {
  return resolveCleanBrowser(profile, false);
}
