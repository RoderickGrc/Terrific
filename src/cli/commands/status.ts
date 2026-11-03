import type { Command } from 'commander';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printColumns, printJson, printLine, wantsJson } from '../output.ts';

export function registerStatusCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program.command('status').description('Show the daemon, running sessions, and open endpoints'),
  ).action(async (_opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const status = await client.status();
    if (wantsJson(cmd)) {
      printJson(io, status);
      return;
    }
    printLine(io, `daemon  127.0.0.1:${status.daemon.port}  ${status.daemon.appVersion}`);
    printColumns(
      io,
      status.sessions.map((session) => [session.id, session.name ?? '(unnamed)', session.status]),
    );
    printColumns(
      io,
      status.endpoints.map((endpoint) => [endpoint.name, endpoint.url, endpoint.projectId]),
    );
  });
}
