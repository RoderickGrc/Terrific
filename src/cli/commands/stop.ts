import type { Command } from 'commander';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, wantsJson } from '../output.ts';
import { resolveRunningId } from '../pick-session.ts';
import { renderSummary } from '../summary.ts';

export function registerStopCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program
      .command('stop')
      .description('Stop a recording session')
      .argument('[id]')
      .option('--name <name>', 'Rename the session as it stops'),
  ).action(async (id: string | undefined, opts: { name?: string }, cmd: Command) => {
    const ctx = createCliContext(io);
    const sessionId = await resolveRunningId(ctx, id);
    const { client } = await ctx.connect();
    await client.stopSession(sessionId, opts.name === undefined ? {} : { name: opts.name });
    const detail = await client.getSession(sessionId);
    if (wantsJson(cmd)) {
      printJson(io, detail);
      return;
    }
    io.stdout(renderSummary(detail));
  });
}
