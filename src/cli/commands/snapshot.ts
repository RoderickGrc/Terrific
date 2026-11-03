import type { Command } from 'commander';
import { TerrificError } from '../../core/errors.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

export function registerSnapshotCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program.command('snapshot').description('Capture a page snapshot').argument('<id>'),
  ).action(async (id: string, _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const capture = await client.snapshot(id);
    if (wantsJson(cmd)) {
      printJson(io, capture);
      return;
    }
    if (capture.event.kind !== 'snapshot') {
      throw new TerrificError('INTERNAL', 'Snapshot did not return a snapshot event.');
    }
    printLine(io, `${capture.event.title}  ${capture.event.wordCount} words`);
  });
}
