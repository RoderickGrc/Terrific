import { join } from 'node:path';
import {
  getNativeClipboard,
  ProcessTerminal,
  type Terminal,
  TuiAltScreen,
} from '@earendil-works/pi-tui';
import { connectDaemon } from '../client/connect.ts';
import type { DaemonClient } from '../client/daemon-client.ts';
import type {
  EndpointView,
  ProfileView,
  ProjectSettingsView,
  ProjectView,
  SessionListItem,
  SessionView,
} from '../core/api.ts';
import { dataPaths, resolveDataRoot } from '../core/data-root.ts';
import { isTerrificError } from '../core/errors.ts';
import { TuiApp } from './app.ts';
import { clock } from './format.ts';
import { colorEnabled, createTheme } from './theme.ts';

export type TuiOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
  platform: string;
  homedir: string;
  stdout(text: string): void;
  stderr(text: string): void;
};

export type InitialData = {
  project: ProjectView;
  storePath: string;
  settings: ProjectSettingsView;
  profiles: ProfileView[];
  endpoints: EndpointView[];
  sessions: SessionListItem[];
  running: SessionView | null;
};

const SLOW_START_MS = 400;

export async function loadInitial(
  client: DaemonClient,
  cwd: string,
  dataRoot: string,
): Promise<InitialData> {
  const project = await client.resolveProject({ cwd });
  const [settings, profiles, endpoints, sessions, status] = await Promise.all([
    client.getSettings(project.id),
    client.listProfiles(),
    client.listEndpoints(project.id),
    client.listSessions(project.id),
    client.status(),
  ]);
  const running =
    status.sessions.find(
      (session) => session.projectId === project.id && session.status === 'recording',
    ) ?? null;
  return {
    project,
    storePath: join(dataPaths(dataRoot).projectsDir, project.id),
    settings,
    profiles,
    endpoints,
    sessions,
    running,
  };
}

async function copyText(terminal: Terminal, text: string): Promise<boolean> {
  const native = getNativeClipboard();
  if (native?.setText !== undefined) {
    try {
      await native.setText(text);
      return true;
    } catch {
      // Fall through to OSC 52, which most terminals accept.
    }
  }
  terminal.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  return true;
}

export type MountedTui = {
  app: TuiApp;
  tui: TuiAltScreen;
  /** Resolves once the user quits and the terminal is restored. */
  done: Promise<void>;
};

export function mountTui(
  terminal: Terminal,
  client: DaemonClient,
  initial: InitialData,
  options: { color: boolean },
): MountedTui {
  const tui = new TuiAltScreen(terminal, false);
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const app = new TuiApp(
    {
      client,
      theme: createTheme({ color: options.color }),
      rows: () => terminal.rows,
      requestRender: () => tui.requestRender(),
      copy: (text) => copyText(terminal, text),
      quit: () => {
        app.dispose();
        tui.stop();
        finish();
      },
    },
    {
      project: initial.project,
      storePath: initial.storePath,
      settings: initial.settings,
      profiles: initial.profiles,
      endpoints: initial.endpoints,
      sessions: initial.sessions,
    },
  );
  tui.setLayoutRoot(app);
  tui.setFocus(app);
  tui.start();
  app.start(initial.running);
  return { app, tui, done };
}

/** What keeps running after the TUI closes, with the commands to come back or stop it. */
export async function detachedMessage(
  client: DaemonClient,
  projectId: string,
  now = Date.now(),
): Promise<string> {
  const status = await client.status();
  const sessions = status.sessions.filter(
    (s) => s.projectId === projectId && s.status === 'recording',
  );
  const endpoints = status.endpoints.filter((e) => e.projectId === projectId && e.state === 'open');
  const lines: string[] = [];
  const cmd = (command: string, what: string): string => `  ${command.padEnd(30)}${what}`;
  for (const session of sessions) {
    const started = Date.parse(session.startedAt);
    const time = Number.isNaN(started) ? '' : ` (${clock(now - started)})`;
    const name = session.name === null ? '' : ` "${session.name}"`;
    lines.push(
      `Session ${session.id}${name} is still recording in the background${time}.`,
      cmd('terrific', 'reopen it, then /attach'),
      cmd(`terrific stop ${session.id}`, 'stop it and print the summary'),
    );
  }
  if (endpoints.length > 0) {
    lines.push(
      `Ingest endpoints still open: ${endpoints.map((e) => e.name).join(', ')}. They keep receiving.`,
    );
  }
  if (lines.length > 0) lines.push(cmd('terrific status', 'running sessions and ingest endpoints'));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export async function runTui(options: TuiOptions): Promise<number> {
  try {
    const dataRoot = resolveDataRoot(options);
    const slow = setTimeout(() => options.stderr('Starting the terrific daemon…\n'), SLOW_START_MS);
    let client: DaemonClient;
    try {
      ({ client } = await connectDaemon({ dataRoot, env: options.env, autoStart: true }));
    } finally {
      clearTimeout(slow);
    }
    const initial = await loadInitial(client, options.cwd, dataRoot);
    const { done } = mountTui(new ProcessTerminal(), client, initial, {
      color: colorEnabled(options.env),
    });
    await done;
    options.stdout(await detachedMessage(client, initial.project.id));
    return 0;
  } catch (error) {
    options.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    if (options.env.TERRIFIC_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
      options.stderr(`${error.stack}\n`);
    }
    return isTerrificError(error) ? error.exitCode : 1;
  }
}
