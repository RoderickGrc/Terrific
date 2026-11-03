import type { Command } from 'commander';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, wantsJson } from '../output.ts';
import { renderSummary } from '../summary.ts';

export function registerShowCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program.command('show').description('Show a session summary').argument('<id>'),
  ).action(async (id: string, _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const detail = await client.getSession(id);
    if (wantsJson(cmd)) {
      printJson(io, detail);
      return;
    }
    io.stdout(renderSummary(detail));
  });
}
