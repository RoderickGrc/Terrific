import type { Command } from 'commander';
import { formatOffset } from '../core/format.ts';
import { createCliContext } from './context.ts';
import type { CliIo } from './io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from './output.ts';

export type MarkKind = 'note' | 'bug' | 'flag';

export function registerMarkCommand(
  program: Command,
  io: CliIo,
  kind: MarkKind,
  textRequired: boolean,
): void {
  const spec = textRequired ? '<text...>' : '[text...]';
  addJsonOption(
    program.command(kind).description(`Add a ${kind}`).argument('<id>').argument(spec),
  ).action(async (id: string, textParts: string[], _opts, cmd: Command) => {
    const text = textParts.join(' ').trim();
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const mark = await client.addMark(id, {
      kind,
      text: text === '' ? null : text,
      author: 'agent',
    });
    if (wantsJson(cmd)) {
      printJson(io, mark);
      return;
    }
    printLine(io, `${kind} at ${formatOffset(mark.t)}`);
  });
}
