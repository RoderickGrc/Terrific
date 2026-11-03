import type { Command } from 'commander';
import type { DaemonClient } from '../../client/daemon-client.ts';
import type { ProfileView } from '../../core/api.ts';
import { TerrificError } from '../../core/errors.ts';
import { type BrowserId, isBrowserId } from '../../core/profiles.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printColumns, printJson, printLine, wantsJson } from '../output.ts';

const POLL_MS = 1000;

function profileRow(profile: ProfileView): string[] {
  const blocked = profile.blockedReason === null ? '' : `blocked: ${profile.blockedReason}`;
  const open = profile.open ? 'open' : '';
  return [`@${profile.slug}`, profile.label, profile.detail, blocked || open];
}

function readBrowser(raw: string | undefined): BrowserId | undefined {
  if (raw === undefined) return undefined;
  if (!isBrowserId(raw)) {
    throw new TerrificError('USAGE', '--browser must be chrome, edge, chromium or comet.');
  }
  return raw;
}

async function findProfile(client: DaemonClient, name: string): Promise<ProfileView | undefined> {
  return (await client.listProfiles()).find((profile) => profile.slug === name);
}

/** Resolves when the tester closes the window, presses Enter, or interrupts; the last two close it here. */
async function waitForSetup(client: DaemonClient, name: string): Promise<void> {
  let stop = (): void => undefined;
  const asked = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onSignal = (): void => {
    stop();
  };
  process.on('SIGINT', onSignal);
  const stdin = process.stdin;
  const listen = stdin.isTTY === true;
  if (listen) {
    stdin.resume();
    stdin.once('data', onSignal);
  }
  try {
    for (;;) {
      const outcome = await Promise.race([
        asked.then(() => 'asked' as const),
        new Promise<'tick'>((resolve) => setTimeout(() => resolve('tick'), POLL_MS)),
      ]);
      if (outcome === 'asked') {
        try {
          await client.closeProfile(name);
        } catch (error) {
          // The window may have closed on its own a moment earlier.
          if (!(error instanceof TerrificError) || error.code !== 'USAGE') throw error;
        }
        return;
      }
      const profile = await findProfile(client, name);
      if (profile === undefined || !profile.open) return;
    }
  } finally {
    process.off('SIGINT', onSignal);
    if (listen) {
      stdin.off('data', onSignal);
      stdin.pause();
    }
  }
}

export function registerProfilesCommand(program: Command, io: CliIo): void {
  const profiles = program
    .command('profiles')
    .description('List browser profiles and manage the ones terrific keeps');

  addJsonOption(
    profiles.command('list', { isDefault: true }).description('List browser profiles'),
  ).action(async (_opts, cmd: Command) => {
    const { client } = await createCliContext(io).connect();
    const list = await client.listProfiles();
    if (wantsJson(cmd)) {
      printJson(io, list);
      return;
    }
    printColumns(io, list.map(profileRow));
  });

  addJsonOption(
    profiles
      .command('add')
      .description('Create a profile terrific keeps in its data folder')
      .argument('<name>')
      .option(
        '--snapshot',
        'Start every session from a saved state and drop what the session changes',
      )
      .option('--browser <browser>', 'chrome, edge, chromium or comet')
      .option('--url <url>', 'Page that profiles open starts on'),
  ).action(
    async (
      name: string,
      opts: { snapshot?: boolean; browser?: string; url?: string },
      cmd: Command,
    ) => {
      const { client } = await createCliContext(io).connect();
      const browser = readBrowser(opts.browser);
      const profile = await client.createProfile({
        name,
        mode: opts.snapshot === true ? 'snapshot' : 'persistent',
        ...(browser === undefined ? {} : { browser }),
        ...(opts.url === undefined ? {} : { url: opts.url }),
      });
      if (wantsJson(cmd)) {
        printJson(io, profile);
        return;
      }
      printLine(io, `Created @${profile.slug}  ${profile.detail}`);
      printLine(io, `Log in or set it up with: terrific profiles open ${profile.slug}`);
    },
  );

  addJsonOption(
    profiles
      .command('open')
      .description('Open a profile in its browser, without recording, to log in or set it up')
      .argument('<name>')
      .argument('[url]', 'Page to open; also becomes the profile page')
      .option('--no-wait', 'Return at once; close it later with profiles close'),
  ).action(async (name: string, url: string | undefined, opts: { wait: boolean }, cmd: Command) => {
    const { client } = await createCliContext(io).connect();
    const opened = await client.openProfile(name, url);
    if (wantsJson(cmd) || !opts.wait) {
      if (wantsJson(cmd)) printJson(io, opened);
      else printLine(io, `@${name} is open. Close it with: terrific profiles close ${name}`);
      return;
    }
    const snapshot = opened.kind === 'snapshot';
    printLine(
      io,
      snapshot
        ? `Opened @${name} in ${opened.browser}. Log in and set it up, then close the browser or press Enter here to save.`
        : `Opened @${name} in ${opened.browser}. Everything it saves is kept. Close the browser or press Enter here when done.`,
    );
    await waitForSetup(client, name);
    const after = await findProfile(client, name);
    if (!snapshot) {
      printLine(io, `Closed @${name}.`);
    } else if (after?.detail.endsWith('nothing saved yet') === true) {
      printLine(io, `Nothing saved for @${name}: the browser had no cookies or site data yet.`);
    } else {
      printLine(io, `Saved @${name}.`);
    }
  });

  addJsonOption(
    profiles
      .command('close')
      .description('Close a profile opened for setup; a snapshot profile saves first')
      .argument('<name>'),
  ).action(async (name: string, _opts, cmd: Command) => {
    const { client } = await createCliContext(io).connect();
    const profile = await client.closeProfile(name);
    if (wantsJson(cmd)) {
      printJson(io, profile);
      return;
    }
    printLine(io, `Closed @${profile.slug}  ${profile.detail}`);
  });

  addJsonOption(
    profiles
      .command('rename')
      .description('Rename a profile terrific keeps')
      .argument('<name>')
      .argument('<new>'),
  ).action(async (name: string, next: string, _opts, cmd: Command) => {
    const { client } = await createCliContext(io).connect();
    const profile = await client.renameProfile(name, next);
    if (wantsJson(cmd)) {
      printJson(io, profile);
      return;
    }
    printLine(io, `@${name} renamed to @${profile.slug}`);
  });

  addJsonOption(
    profiles
      .command('rm')
      .description('Delete a profile terrific keeps, with its logins and data')
      .argument('<name>'),
  ).action(async (name: string, _opts, cmd: Command) => {
    const { client } = await createCliContext(io).connect();
    const result = await client.removeProfile(name);
    if (wantsJson(cmd)) {
      printJson(io, result);
      return;
    }
    printLine(io, `Deleted @${name}`);
  });
}
