import { getRandomValues } from 'node:crypto';
import { access } from 'node:fs/promises';
import type { Command } from 'commander';
import pkg from '../../../package.json' with { type: 'json' };
import { connectDaemon, isDaemonUnreachable } from '../../client/connect.ts';
import { parseDaemonPort } from '../../core/api.ts';
import { dataPaths, resolveDataRoot } from '../../core/data-root.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

function dataRootFrom(io: CliIo): string {
  return resolveDataRoot({ env: io.env, platform: io.platform, homedir: io.homedir });
}

async function fileGone(path: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      await access(path);
    } catch {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

export function registerDaemonCommand(program: Command, io: CliIo): void {
  const daemon = program.command('daemon').description('Manage the terrific-cli daemon');

  addJsonOption(
    daemon.command('start').description('Start the daemon if it is not running'),
  ).action(async (_opts, cmd: Command) => {
    const connected = await connectDaemon({
      dataRoot: dataRootFrom(io),
      env: io.env,
      autoStart: true,
    });
    if (wantsJson(cmd)) {
      printJson(io, { host: '127.0.0.1', port: connected.port, started: connected.started });
      return;
    }
    printLine(io, `daemon running on 127.0.0.1:${connected.port}`);
    printLine(io, connected.started ? 'started' : 'already running');
  });

  addJsonOption(daemon.command('stop').description('Stop the daemon')).action(
    async (_opts, cmd: Command) => {
      const root = dataRootFrom(io);
      let running = true;
      try {
        const connected = await connectDaemon({ dataRoot: root, env: io.env, autoStart: false });
        await connected.client.shutdown();
        await fileGone(dataPaths(root).daemonFile, 2000);
      } catch (error) {
        if (!isDaemonUnreachable(error)) throw error;
        running = false;
      }
      if (wantsJson(cmd)) {
        printJson(io, { running: false });
        return;
      }
      printLine(io, running ? 'daemon stopped' : 'daemon not running');
    },
  );

  addJsonOption(daemon.command('status').description('Show whether the daemon is running')).action(
    async (_opts, cmd: Command) => {
      try {
        const connected = await connectDaemon({
          dataRoot: dataRootFrom(io),
          env: io.env,
          autoStart: false,
        });
        const health = await connected.client.health();
        if (wantsJson(cmd)) {
          printJson(io, { running: true, ...health });
          return;
        }
        printLine(io, `daemon running on 127.0.0.1:${health.port}`);
      } catch (error) {
        if (!isDaemonUnreachable(error)) throw error;
        if (wantsJson(cmd)) {
          printJson(io, { running: false });
          return;
        }
        printLine(io, 'daemon not running');
      }
    },
  );

  daemon
    .command('run')
    .description('Run the daemon in the foreground')
    .action(async () => {
      let release = (): void => undefined;
      const stopped = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Dynamic so `daemon start` never loads Playwright or the HTTP server.
      const [{ startDaemon }, { resolveBrowserProfile }] = await Promise.all([
        import('../../daemon/daemon.ts'),
        import('../../daemon/resolve-browser.ts'),
      ]);
      const headless = io.env.TERRIFIC_HEADLESS === '1';
      const handle = await startDaemon({
        dataRoot: dataRootFrom(io),
        port: parseDaemonPort(io.env.TERRIFIC_PORT),
        appVersion: pkg.version,
        now: () => new Date(),
        random: (n) => getRandomValues(new Uint8Array(n)),
        resolveBrowser: (profile) => resolveBrowserProfile(profile, headless),
        onShutdown: () => {
          release();
        },
      });
      const onSignal = (): void => {
        void handle.close().finally(() => {
          release();
        });
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      try {
        await stopped;
      } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    });
}
