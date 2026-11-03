import type { Command } from 'commander';
import type { CliIo, GlobalOpts } from './io.ts';

export function wantsJson(cmd: Command): boolean {
  const opts = cmd.optsWithGlobals() as GlobalOpts;
  return opts.json === true;
}

export function printLine(io: CliIo, text: string): void {
  io.stdout(`${text}\n`);
}

export function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

export function printColumns(io: CliIo, rows: string[][]): void {
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i] ?? '';
      const current = widths[i] ?? 0;
      if (cell.length > current) widths[i] = cell.length;
    }
  }
  for (const row of rows) {
    const parts: string[] = [];
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i] ?? '';
      const last = i === row.length - 1;
      parts.push(last ? cell : cell.padEnd((widths[i] ?? 0) + 2));
    }
    printLine(io, parts.join(''));
  }
}

export function formatAgo(iso: string, now: Date): string {
  const parsed = Date.parse(iso);
  const ms = Number.isFinite(parsed) ? Math.max(0, now.getTime() - parsed) : 0;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function addJsonOption(cmd: Command): Command {
  return cmd.option('--json', 'Print one JSON document');
}
