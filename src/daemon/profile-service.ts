import type { CreateProfileRequest, ProfileView } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import { BROWSER_IDS, type BrowserId, type ProfileRecord } from '../core/profiles.ts';
import { localMinute, normalizeUrl } from '../core/setup.ts';
import type { InstalledBrowser } from '../recorder/browsers.ts';
import {
  captureState,
  hasState,
  type LaunchedBrowser,
  type LaunchOptions,
} from '../recorder/launch.ts';
import { type BrowserProfile, browserDisplayName, toLaunchOptions } from '../recorder/profiles.ts';
import type { ProfileStore } from '../store/profiles.ts';

export type ProfileService = {
  list(): Promise<ProfileView[]>;
  /** Launch options for a session that records with this profile. */
  resolve(slug: string): Promise<LaunchOptions>;
  create(request: CreateProfileRequest): Promise<ProfileView>;
  rename(name: string, next: string): Promise<ProfileView>;
  remove(name: string): Promise<void>;
  /** Opens the profile's browser, without recording, so the tester can log in and set it up. */
  open(name: string, url?: string): Promise<ProfileView>;
  /** Closes a profile opened for setup; a snapshot profile saves its state first. */
  close(name: string): Promise<ProfileView>;
  closeAll(): Promise<void>;
};

type Editing = {
  record: ProfileRecord;
  launched: LaunchedBrowser;
  /** Last state read while the window was open, kept because a closed window can no longer be read. */
  lastState: string | null;
  timer: ReturnType<typeof setInterval> | undefined;
  done: Promise<void> | undefined;
};

export type ProfileServiceOptions = {
  store: ProfileStore;
  headless: boolean;
  /** Clean plus the installed browsers' own profiles, with slugs. */
  machineProfiles: () => BrowserProfile[];
  installedBrowsers: () => InstalledBrowser[];
  launch: (options: LaunchOptions) => Promise<LaunchedBrowser>;
  captureEveryMs?: number;
};

const CAPTURE_EVERY_MS = 2000;

export function createProfileService(options: ProfileServiceOptions): ProfileService {
  const editing = new Map<string, Editing>();

  function browserFor(id: BrowserId): InstalledBrowser {
    const found = options.installedBrowsers().find((browser) => browser.id === id);
    if (found === undefined) {
      throw new TerrificError('USAGE', `${browserDisplayName(id)} is not installed.`);
    }
    return found;
  }

  function defaultBrowser(): BrowserId {
    const installed = options.installedBrowsers();
    const found = BROWSER_IDS.find((id) => installed.some((browser) => browser.id === id));
    if (found === undefined) throw new TerrificError('USAGE', 'No supported browser is installed.');
    return found;
  }

  function detail(record: ProfileRecord): string {
    const browser = browserDisplayName(record.browser);
    if (record.mode === 'persistent') return `${browser} · keeps logins and data`;
    if (record.savedAt === null) return `${browser} · nothing saved yet`;
    return `${browser} · starts from state saved ${localMinute(new Date(record.savedAt))}`;
  }

  function managedView(record: ProfileRecord): ProfileView {
    return {
      slug: record.name,
      label: record.name,
      detail: detail(record),
      browser: browserDisplayName(record.browser),
      blockedReason: null,
      kind: record.mode,
      open: editing.has(record.name),
    };
  }

  // Profiles terrific owns keep their name; a browser profile with the same slug gets its browser appended.
  function machineFor(records: readonly ProfileRecord[]): BrowserProfile[] {
    const taken = new Set(records.map((record) => record.name));
    return options
      .machineProfiles()
      .map((profile) =>
        taken.has(profile.slug)
          ? { ...profile, slug: `${profile.slug}-${profile.browserId}` }
          : profile,
      );
  }

  function machineView(profile: BrowserProfile): ProfileView {
    return {
      slug: profile.slug,
      label: profile.label,
      detail: profile.detail,
      browser: browserDisplayName(profile.browserId),
      blockedReason: profile.blockedReason,
      kind: profile.id === 'clean' ? 'clean' : 'browser',
      open: false,
    };
  }

  async function list(): Promise<ProfileView[]> {
    const records = await options.store.list();
    const machine = machineFor(records).map(machineView);
    const clean = machine.filter((view) => view.kind === 'clean');
    const others = machine.filter((view) => view.kind !== 'clean');
    return [...clean, ...records.map(managedView), ...others];
  }

  function launchOptions(record: ProfileRecord): LaunchOptions {
    const browser = browserFor(record.browser);
    const paths = options.store.paths(record.name);
    const base = {
      executablePath: browser.executablePath,
      headless: options.headless,
      browserName: browserDisplayName(record.browser),
      profileLabel: record.name,
    };
    if (record.mode === 'persistent') return { ...base, userDataDir: paths.browserDir };
    return { ...base, userDataDir: null, storageState: paths.stateFile };
  }

  async function resolve(slug: string): Promise<LaunchOptions> {
    const records = await options.store.list();
    const record = records.find((item) => item.name === slug);
    if (record !== undefined) {
      if (record.mode === 'persistent' && editing.has(record.name)) {
        throw new TerrificError(
          'CONFLICT',
          `The profile "${slug}" is open for setup. Close it first: terrific profiles close ${slug}`,
        );
      }
      return launchOptions(record);
    }
    const found = machineFor(records).find((item) => item.slug === slug);
    if (found === undefined) {
      throw new TerrificError(
        'USAGE',
        `No browser profile called "${slug}". Run terrific profiles to list them.`,
      );
    }
    if (found.blockedReason !== null) {
      throw new TerrificError(
        'USAGE',
        `${found.blockedReason}. Create a profile terrific owns instead: terrific profiles add <name> --browser ${found.browserId}`,
      );
    }
    return toLaunchOptions(found, options.headless);
  }

  async function create(request: CreateProfileRequest): Promise<ProfileView> {
    const browser = request.browser ?? defaultBrowser();
    browserFor(browser);
    const url = request.url === undefined || request.url === '' ? '' : normalizeUrl(request.url);
    const record = await options.store.create({
      name: request.name,
      mode: request.mode,
      browser,
      url,
    });
    return managedView(record);
  }

  function refuseWhileOpen(name: string, action: string): void {
    if (editing.has(name)) {
      throw new TerrificError(
        'CONFLICT',
        `Close the profile "${name}" before you ${action} it: terrific profiles close ${name}`,
      );
    }
  }

  async function rename(name: string, next: string): Promise<ProfileView> {
    refuseWhileOpen(name, 'rename');
    return managedView(await options.store.rename(name, next));
  }

  async function remove(name: string): Promise<void> {
    refuseWhileOpen(name, 'delete');
    await options.store.remove(name);
  }

  async function capture(entry: Editing): Promise<void> {
    try {
      const state = await captureState(entry.launched.context);
      if (hasState(state)) entry.lastState = state;
    } catch {
      // The window is closing; keep the last state read.
    }
  }

  // Ends a setup once, whether the tester closed the window or asked to close it.
  function finish(name: string, readNow: boolean): Promise<void> {
    const entry = editing.get(name);
    if (entry === undefined) return Promise.resolve();
    if (entry.done !== undefined) return entry.done;
    entry.done = (async () => {
      if (entry.timer !== undefined) clearInterval(entry.timer);
      if (entry.record.mode === 'snapshot') {
        if (readNow) await capture(entry);
        if (entry.lastState !== null) await options.store.writeState(name, entry.lastState);
      }
      await entry.launched.close();
      editing.delete(name);
    })();
    return entry.done;
  }

  async function open(name: string, url?: string): Promise<ProfileView> {
    let record = await options.store.load(name);
    if (editing.has(name)) {
      throw new TerrificError('CONFLICT', `The profile "${name}" is already open.`);
    }
    if (url !== undefined && url !== '') {
      record = await options.store.update(name, { url: normalizeUrl(url) });
    }
    const launched = await options.launch(launchOptions(record));
    const entry: Editing = { record, launched, lastState: null, timer: undefined, done: undefined };
    editing.set(name, entry);
    if (record.mode === 'snapshot') {
      entry.timer = setInterval(() => {
        void capture(entry);
      }, options.captureEveryMs ?? CAPTURE_EVERY_MS);
    }
    const context = launched.context;
    const onPageClosed = (): void => {
      if (context.pages().length === 0) void finish(name, false);
    };
    for (const page of context.pages()) page.on('close', onPageClosed);
    context.on('page', (page) => {
      page.on('close', onPageClosed);
    });
    context.on('close', () => {
      void finish(name, false);
    });
    if (record.url !== '') {
      try {
        await launched.page.goto(record.url);
      } catch {
        // An unreachable page still leaves the window open to set up by hand.
      }
    }
    return managedView(record);
  }

  async function close(name: string): Promise<ProfileView> {
    if (!editing.has(name)) {
      throw new TerrificError('USAGE', `The profile "${name}" is not open.`);
    }
    await finish(name, true);
    return managedView(await options.store.load(name));
  }

  async function closeAll(): Promise<void> {
    await Promise.all([...editing.keys()].map((name) => finish(name, true)));
  }

  return { list, resolve, create, rename, remove, open, close, closeAll };
}
