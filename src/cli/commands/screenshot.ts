import type { Command } from 'commander';
import { TerrificError } from '../../core/errors.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

export function registerScreenshotCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program.command('screenshot').description('Capture a screenshot').argument('<id>'),
  ).action(async (id: string, _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const capture = await client.screenshot(id);
    if (wantsJson(cmd)) {
      printJson(io, capture);
      return;
    }
    const file = capture.file ?? (capture.event.kind === 'screenshot' ? capture.event.file : null);
    if (file === null) {
      throw new TerrificError('INTERNAL', 'Screenshot did not return a file path.');
    }
    printLine(io, file);
  });
}
