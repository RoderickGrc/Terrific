import type { Command } from 'commander';
import type { SessionListItem } from '../../core/api.ts';
import { formatDuration } from '../../core/format.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printColumns, printJson, wantsJson } from '../output.ts';

function listDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function newestFirst(items: SessionListItem[]): SessionListItem[] {
  return [...items].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function registerSessionsCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program
      .command('sessions')
      .description('List sessions of this project')
      .option('--legacy', 'List the global legacy store'),
  ).action(async (opts: { legacy?: boolean }, cmd: Command) => {
    const ctx = createCliContext(io);
    const { client } = await ctx.connect();
    const items =
      opts.legacy === true
        ? await client.listLegacySessions()
        : await client.listSessions((await ctx.project()).id);
    const ordered = newestFirst(items);
    if (wantsJson(cmd)) {
      printJson(io, ordered);
      return;
    }
    printColumns(
      io,
      ordered.map((item) => [
        item.id,
        item.status,
        listDate(item.startedAt),
        formatDuration(item.durationMs),
        String(item.bugs),
        String(item.flags),
        String(item.errors),
        item.legacy ? `${item.name ?? '(unnamed)'}  legacy` : (item.name ?? '(unnamed)'),
      ]),
    );
  });
}
