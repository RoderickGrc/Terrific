import { existsSync, readFileSync } from 'node:fs';
import { findInstalledBrowsers, type InstalledBrowser } from '../recorder/browsers.ts';
import { type BrowserProfile, discoverProfiles } from '../recorder/profiles.ts';

function readLocalState(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function installedBrowsers(): InstalledBrowser[] {
  return findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
}

/** Clean plus the profiles each installed browser lists in its `Local State`. */
export function discoverMachineProfiles(): BrowserProfile[] {
  return discoverProfiles({ browsers: installedBrowsers(), readFile: readLocalState });
}
