import { existsSync } from 'node:fs';
import { findInstalledBrowsers, type InstalledBrowser } from '../recorder/browsers.ts';

export function installedBrowsers(): InstalledBrowser[] {
  return findInstalledBrowsers({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
  });
}
