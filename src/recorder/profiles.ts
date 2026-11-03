import { join } from 'node:path';
import { assignProfileSlugs } from '../core/setup.ts';
import { isRecord, isString } from '../core/validate.ts';
import type { BrowserId, InstalledBrowser } from './browsers.ts';
import type { LaunchOptions } from './launch.ts';

export const CHROME_PROFILE_BLOCKED = 'Chrome 136+ blocks automation of its own profiles';

const CLEAN_ORDER: readonly BrowserId[] = ['chrome', 'edge', 'chromium', 'comet'];

export type BrowserProfile = {
  id: string;
  slug: string;
  label: string;
  detail: string;
  browserId: BrowserId;
  executablePath: string;
  userDataDir: string | null;
  profileDirectory: string | null;
  blockedReason: string | null;
};

export type DiscoverProfilesInput = {
  browsers: InstalledBrowser[];
  readFile: (path: string) => string | null;
};

export function browserDisplayName(id: BrowserId): string {
  switch (id) {
    case 'chrome':
      return 'Google Chrome';
    case 'edge':
      return 'Microsoft Edge';
    case 'chromium':
      return 'Chromium';
    case 'comet':
      return 'Comet';
  }
}

export function profileAutomationFailed(browserName: string, label: string): string {
  return (
    `${browserName} did not accept automation for profile "${label}". ` +
    `Close ${browserName} if it is open, or use @clean.`
  );
}

export function toLaunchOptions(profile: BrowserProfile, headless: boolean): LaunchOptions {
  const options: LaunchOptions = {
    executablePath: profile.executablePath,
    userDataDir: profile.userDataDir,
    headless,
    browserName: browserDisplayName(profile.browserId),
    profileLabel: profile.label,
  };
  if (profile.profileDirectory !== null) options.profileDirectory = profile.profileDirectory;
  return options;
}

export function discoverProfiles(input: DiscoverProfilesInput): BrowserProfile[] {
  const drafts: Omit<BrowserProfile, 'slug'>[] = [];
  const clean = cleanProfile(input.browsers);
  if (clean !== undefined) drafts.push(clean);

  for (const browser of input.browsers) {
    drafts.push(...realProfiles(browser, input.readFile));
  }

  const slugs = assignProfileSlugs(
    drafts.map((profile) => ({
      id: profile.id,
      label: profile.label,
      browser: profile.browserId,
      detail: profile.detail,
      ...(profile.blockedReason === null ? {} : { blockedReason: profile.blockedReason }),
    })),
  );

  return drafts.map((profile, index) => {
    const option = slugs[index];
    return {
      ...profile,
      slug: option?.slug ?? `profile-${index + 1}`,
    };
  });
}

function cleanProfile(browsers: InstalledBrowser[]): Omit<BrowserProfile, 'slug'> | undefined {
  for (const id of CLEAN_ORDER) {
    const match = browsers.find((browser) => browser.id === id);
    if (match === undefined) continue;
    return {
      id: 'clean',
      label: 'Clean browser',
      detail: 'fresh storage, nothing saved',
      browserId: match.id,
      executablePath: match.executablePath,
      userDataDir: null,
      profileDirectory: null,
      blockedReason: null,
    };
  }
  return undefined;
}

function realProfiles(
  browser: InstalledBrowser,
  readFile: (path: string) => string | null,
): Omit<BrowserProfile, 'slug'>[] {
  if (browser.userDataRoot === null) return [];
  const contents = readFile(join(browser.userDataRoot, 'Local State'));
  if (contents === null) return [];
  const entries = readInfoCache(contents);
  if (entries === null) return [];
  entries.sort((left, right) => compareProfileDirs(left.directory, right.directory));
  const blocked = browser.id === 'chrome' ? CHROME_PROFILE_BLOCKED : null;
  return entries.map((entry) => ({
    id: `${browser.id}:${entry.directory}`,
    label: entry.name,
    detail: `${browser.name} · ${entry.directory}`,
    browserId: browser.id,
    executablePath: browser.executablePath,
    userDataDir: browser.userDataRoot,
    profileDirectory: entry.directory,
    blockedReason: blocked,
  }));
}

function readInfoCache(contents: string): { directory: string; name: string }[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.profile) || !isRecord(parsed.profile.info_cache)) {
    return null;
  }
  const rows: { directory: string; name: string }[] = [];
  for (const [directory, value] of Object.entries(parsed.profile.info_cache)) {
    if (!isRecord(value) || !isString(value.name) || value.name === '') continue;
    rows.push({ directory, name: value.name });
  }
  return rows;
}

function compareProfileDirs(left: string, right: string): number {
  const a = profileDirRank(left);
  const b = profileDirRank(right);
  if (a.group !== b.group) return a.group - b.group;
  if (a.n !== b.n) return a.n - b.n;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function profileDirRank(directory: string): { group: number; n: number } {
  if (directory === 'Default') return { group: 0, n: 0 };
  const match = /^Profile (\d+)$/.exec(directory);
  if (match?.[1] !== undefined) return { group: 1, n: Number(match[1]) };
  return { group: 2, n: 0 };
}
