import { existsSync, readFileSync } from 'node:fs';
import type { ProfileView } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { findInstalledBrowsers } from '../recorder/browsers.ts';
import type { LaunchOptions } from '../recorder/launch.ts';
import {
  type BrowserProfile,
  browserDisplayName,
  discoverProfiles,
  toLaunchOptions,
} from '../recorder/profiles.ts';

function readLocalState(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function discoverMachineProfiles(): BrowserProfile[] {
  return discoverProfiles({
    browsers: findInstalledBrowsers({
      platform: process.platform,
      env: process.env,
      exists: existsSync,
    }),
    readFile: readLocalState,
  });
}

export function listProfileViews(): ProfileView[] {
  return discoverMachineProfiles().map((profile) => ({
    slug: profile.slug,
    label: profile.label,
    detail: profile.detail,
    browser: browserDisplayName(profile.browserId),
    blockedReason: profile.blockedReason,
  }));
}

export function resolveBrowserProfile(profile: string, headless: boolean): LaunchOptions {
  const found = discoverMachineProfiles().find((item) => item.slug === profile);
  if (found === undefined) {
    throw new TerrificError(
      'USAGE',
      `No browser profile called "${profile}". Run terrific profiles to list them.`,
    );
  }
  if (found.blockedReason !== null) {
    throw new TerrificError('USAGE', found.blockedReason);
  }
  return toLaunchOptions(found, headless);
}

export function defaultResolveBrowser(profile: string): LaunchOptions {
  return resolveBrowserProfile(profile, false);
}
