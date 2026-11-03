import type { Command } from 'commander';
import { TerrificError } from '../../core/errors.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, wantsJson } from '../output.ts';

export function registerPromptCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program
      .command('prompt')
      .description('Print a copy payload for the session')
      .argument('<id>')
      .option('--bugs', 'Print bugs and errors')
      .option('--full', 'Print the full context file'),
  ).action(async (id: string, opts: { bugs?: boolean; full?: boolean }, cmd: Command) => {
    if (opts.bugs === true && opts.full === true) {
      throw new TerrificError('USAGE', 'Use only one of --bugs or --full.');
    }
    const kind = opts.bugs === true ? 'bugs' : opts.full === true ? 'full' : 'agent';
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const prompt = await client.prompt(id, kind);
    if (wantsJson(cmd)) {
      printJson(io, prompt);
      return;
    }
    // A final newline keeps the shell prompt off the last line; the text itself is unchanged.
    io.stdout(prompt.text.endsWith('\n') ? prompt.text : `${prompt.text}\n`);
  });
}
