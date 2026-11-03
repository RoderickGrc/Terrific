import type { BrowserView, CreateProfileRequest, ProfileView } from '../core/api.ts';
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
import { browserDisplayName } from '../recorder/profiles.ts';
import type { ProfileStore } from '../store/profiles.ts';

export type ProfileService = {
  list(): Promise<ProfileView[]>;
  /** Installed browsers a new profile can use. */
  browsers(): BrowserView[];
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
  installedBrowsers: () => InstalledBrowser[];
  launch: (options: LaunchOptions) => Promise<LaunchedBrowser>;
  captureEveryMs?: number;
};

const CAPTURE_EVERY_MS = 2000;

// Chrome, Edge and Comet refuse automation of their own profiles, so only clean and the profiles terrific keeps are offered.
export function createProfileService(options: ProfileServiceOptions): ProfileService {
  const editing = new Map<string, Editing>();

  function browserFor(id: BrowserId): InstalledBrowser {
    const found = options.installedBrowsers().find((browser) => browser.id === id);
    if (found === undefined) {
      throw new TerrificError('USAGE', `${browserDisplayName(id)} is not installed.`);
    }
    return found;
  }

  /** The first installed browser in Chrome, Edge, Chromium, Comet order. */
  function firstBrowser(): InstalledBrowser | undefined {
    const installed = options.installedBrowsers();
    for (const id of BROWSER_IDS) {
      const found = installed.find((browser) => browser.id === id);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function browsers(): BrowserView[] {
    const installed = options.installedBrowsers();
    return BROWSER_IDS.filter((id) => installed.some((browser) => browser.id === id)).map((id) => ({
      id,
      name: browserDisplayName(id),
    }));
  }

  function detail(record: ProfileRecord): string {
    const browser = browserDisplayName(record.browser);
    if (record.mode === 'persistent') return `${browser} · keeps logins and data`;
    if (record.savedAt === null) return `${browser} · nothing saved yet`;
    return `${browser} · saved ${localMinute(new Date(record.savedAt))}`;
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

  async function list(): Promise<ProfileView[]> {
    const records = await options.store.list();
    const first = firstBrowser();
    const clean: ProfileView[] =
      first === undefined
        ? []
        : [
            {
              slug: 'clean',
              label: 'Clean browser',
              detail: 'fresh storage, nothing saved',
              browser: browserDisplayName(first.id),
              blockedReason: null,
              kind: 'clean',
              open: false,
            },
          ];
    return [...clean, ...records.map(managedView)];
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
    if (slug === 'clean') {
      const first = firstBrowser();
      if (first === undefined)
        throw new TerrificError('USAGE', 'No supported browser is installed.');
      return {
        executablePath: first.executablePath,
        userDataDir: null,
        headless: options.headless,
        browserName: browserDisplayName(first.id),
        profileLabel: 'Clean browser',
      };
    }
    const record = await options.store.get(slug);
    if (record === null) {
      throw new TerrificError(
        'USAGE',
        `No profile called "${slug}". Create it with: terrific profiles add ${slug}`,
      );
    }
    if (record.mode === 'persistent' && editing.has(record.name)) {
      throw new TerrificError(
        'CONFLICT',
        `The profile "${slug}" is open for setup. Close it first: terrific profiles close ${slug}`,
      );
    }
    return launchOptions(record);
  }

  async function create(request: CreateProfileRequest): Promise<ProfileView> {
    const browser = request.browser ?? firstBrowser()?.id;
    if (browser === undefined)
      throw new TerrificError('USAGE', 'No supported browser is installed.');
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

  return { list, browsers, resolve, create, rename, remove, open, close, closeAll };
}
