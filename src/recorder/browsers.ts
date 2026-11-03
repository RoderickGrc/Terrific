import { posix, win32 } from 'node:path';
import type { BrowserId } from '../core/profiles.ts';

export type { BrowserId };

export type InstalledBrowser = {
  id: BrowserId;
  name: string;
  executablePath: string;
  userDataRoot: string | null;
};

export type FindBrowsersInput = {
  platform: string;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
};

type PathApi = { join: (...parts: string[]) => string };

function envValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  return value !== undefined && value !== '' ? value : undefined;
}

function firstExisting(
  exists: (path: string) => boolean,
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

function homeDir(env: Record<string, string | undefined>): string | undefined {
  return envValue(env, 'HOME') ?? envValue(env, 'USERPROFILE');
}

function windowsChrome(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): string | undefined {
  const join = win32.join;
  const local = envValue(env, 'LOCALAPPDATA');
  const program = envValue(env, 'PROGRAMFILES');
  const programX86 = envValue(env, 'PROGRAMFILES(X86)');
  const suffix = ['Google', 'Chrome', 'Application', 'chrome.exe'] as const;
  const candidates: string[] = [];
  if (program !== undefined) candidates.push(join(program, ...suffix));
  if (programX86 !== undefined) candidates.push(join(programX86, ...suffix));
  if (local !== undefined) candidates.push(join(local, ...suffix));
  return firstExisting(exists, candidates);
}

function windowsEdge(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): string | undefined {
  const join = win32.join;
  const program = envValue(env, 'PROGRAMFILES');
  const programX86 = envValue(env, 'PROGRAMFILES(X86)');
  const suffix = ['Microsoft', 'Edge', 'Application', 'msedge.exe'] as const;
  const candidates: string[] = [];
  if (program !== undefined) candidates.push(join(program, ...suffix));
  if (programX86 !== undefined) candidates.push(join(programX86, ...suffix));
  return firstExisting(exists, candidates);
}

function unixBins(path: PathApi, names: readonly string[]): string[] {
  const roots = ['/usr/bin', '/usr/local/bin', '/snap/bin'];
  const out: string[] = [];
  for (const root of roots) {
    for (const name of names) out.push(path.join(root, name));
  }
  return out;
}

function macApp(path: PathApi, app: string, exec: string): string {
  return path.join('/Applications', `${app}.app`, 'Contents', 'MacOS', exec);
}

export function findInstalledBrowsers(input: FindBrowsersInput): InstalledBrowser[] {
  const { platform, env, exists } = input;
  const path = platform === 'win32' ? win32 : posix;
  const home = homeDir(env);
  const local = envValue(env, 'LOCALAPPDATA');
  const found: InstalledBrowser[] = [];

  if (platform === 'win32') {
    const chrome = windowsChrome(env, exists);
    if (chrome !== undefined) {
      found.push({
        id: 'chrome',
        name: 'Google Chrome',
        executablePath: chrome,
        userDataRoot:
          local === undefined ? null : win32.join(local, 'Google', 'Chrome', 'User Data'),
      });
    }
    const edge = windowsEdge(env, exists);
    if (edge !== undefined) {
      found.push({
        id: 'edge',
        name: 'Microsoft Edge',
        executablePath: edge,
        userDataRoot:
          local === undefined ? null : win32.join(local, 'Microsoft', 'Edge', 'User Data'),
      });
    }
    if (local !== undefined) {
      const comet = win32.join(local, 'Perplexity', 'Comet', 'Application', 'comet.exe');
      if (exists(comet)) {
        found.push({
          id: 'comet',
          name: 'Comet',
          executablePath: comet,
          userDataRoot: win32.join(local, 'Perplexity', 'Comet', 'User Data'),
        });
      }
    }
    return found;
  }

  if (platform === 'darwin') {
    const chrome = macApp(path, 'Google Chrome', 'Google Chrome');
    if (exists(chrome)) {
      found.push({
        id: 'chrome',
        name: 'Google Chrome',
        executablePath: chrome,
        userDataRoot:
          home === undefined
            ? null
            : path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      });
    }
    const edge = macApp(path, 'Microsoft Edge', 'Microsoft Edge');
    if (exists(edge)) {
      found.push({
        id: 'edge',
        name: 'Microsoft Edge',
        executablePath: edge,
        userDataRoot:
          home === undefined
            ? null
            : path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      });
    }
    const comet = macApp(path, 'Comet', 'Comet');
    if (exists(comet)) {
      // Comet's macOS user-data path is not confirmed, so profiles cannot use it yet.
      found.push({ id: 'comet', name: 'Comet', executablePath: comet, userDataRoot: null });
    }
    const chromium = macApp(path, 'Chromium', 'Chromium');
    if (exists(chromium)) {
      found.push({
        id: 'chromium',
        name: 'Chromium',
        executablePath: chromium,
        userDataRoot:
          home === undefined ? null : path.join(home, 'Library', 'Application Support', 'Chromium'),
      });
    }
    return found;
  }

  const chrome = firstExisting(exists, unixBins(path, ['google-chrome', 'google-chrome-stable']));
  if (chrome !== undefined) {
    found.push({
      id: 'chrome',
      name: 'Google Chrome',
      executablePath: chrome,
      userDataRoot: home === undefined ? null : path.join(home, '.config', 'google-chrome'),
    });
  }
  const edge = firstExisting(exists, unixBins(path, ['microsoft-edge']));
  if (edge !== undefined) {
    found.push({
      id: 'edge',
      name: 'Microsoft Edge',
      executablePath: edge,
      userDataRoot: home === undefined ? null : path.join(home, '.config', 'microsoft-edge'),
    });
  }
  const chromium = firstExisting(exists, unixBins(path, ['chromium', 'chromium-browser']));
  if (chromium !== undefined) {
    found.push({
      id: 'chromium',
      name: 'Chromium',
      executablePath: chromium,
      userDataRoot: home === undefined ? null : path.join(home, '.config', 'chromium'),
    });
  }
  return found;
}
