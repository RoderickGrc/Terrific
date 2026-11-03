import type { Command } from 'commander';
import type { ContextOnly } from '../../core/context-export.ts';
import { TerrificError } from '../../core/errors.ts';
import { formatBytes, formatTokens } from '../../core/format.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

const ONLY = new Set(['bug', 'flag', 'note', 'errors']);

function isContextOnly(value: string): value is ContextOnly {
  return ONLY.has(value);
}

function parseOnly(raw: string | undefined): ContextOnly[] | undefined {
  if (raw === undefined || raw === '') return undefined;
  const only: ContextOnly[] = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!isContextOnly(token)) {
      throw new TerrificError('USAGE', '--only must be a comma list of bug, flag, note, errors.');
    }
    only.push(token);
  }
  return only;
}

export function registerContextCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program
      .command('context')
      .description('Write or refresh context.txt')
      .argument('<id>')
      .option('--only <list>', 'Limit the export to bug, flag, note, and/or errors'),
  ).action(async (id: string, opts: { only?: string }, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const only = parseOnly(opts.only);
    const written = await client.writeContext(id, only === undefined ? {} : { only });
    if (wantsJson(cmd)) {
      printJson(io, written);
      return;
    }
    const size = `${formatBytes(written.bytes)}  ${formatTokens(written.approxTokens)}`;
    printLine(io, `${written.path}  ${size}`);
  });
}
