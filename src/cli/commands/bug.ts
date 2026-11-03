import type { Command } from 'commander';
import type { CliIo } from '../io.ts';
import { registerMarkCommand } from '../mark-action.ts';

export function registerBugCommand(program: Command, io: CliIo): void {
  registerMarkCommand(program, io, 'bug', false);
}
