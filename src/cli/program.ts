import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { isTerrificError } from '../core/errors.ts';
import { registerBugCommand } from './commands/bug.ts';
import { registerDaemonCommand } from './commands/daemon.ts';
import { registerDoctorCommand } from './commands/doctor.ts';
import { registerEventsCommand } from './commands/events.ts';
import { registerFlagCommand } from './commands/flag.ts';
import { registerIngestCommand } from './commands/ingest.ts';
import { registerNoteCommand } from './commands/note.ts';
import { registerProfilesCommand } from './commands/profiles.ts';
import { registerProjectsCommand } from './commands/projects.ts';
import { registerPromptCommand } from './commands/prompt.ts';
import { registerScreenshotCommand } from './commands/screenshot.ts';
import { registerContextCommand } from './commands/session-context.ts';
import { registerSessionsCommand } from './commands/sessions.ts';
import { registerShowCommand } from './commands/show.ts';
import { registerSnapshotCommand } from './commands/snapshot.ts';
import { registerStartCommand } from './commands/start.ts';
import { registerStatusCommand } from './commands/status.ts';
import { registerStopCommand } from './commands/stop.ts';
import { isCliExit } from './exit.ts';
import type { CliIo } from './io.ts';
import { addJsonOption, printJson } from './output.ts';

export type { CliIo } from './io.ts';

function argvWantsJson(argv: string[]): boolean {
  return argv.includes('--json');
}

function handleError(error: unknown, io: CliIo, json: boolean): number {
  if (isCliExit(error)) return error.exitCode;
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : 2;
  }
  if (isTerrificError(error)) {
    if (json) printJson(io, { error: { code: error.code, message: error.message } });
    else io.stderr(`error: ${error.message}\n`);
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  if (json) printJson(io, { error: { code: 'INTERNAL', message } });
  else io.stderr(`error: ${message}\n`);
  if (io.env.TERRIFIC_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
    io.stderr(`${error.stack}\n`);
  }
  return 1;
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name('terrific-cli')
    .description('Record QA sessions in a real browser from your terminal')
    .version(pkg.version, '--version')
    .exitOverride()
    .showHelpAfterError('(run terrific-cli --help for usage)')
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      writeErr: (text) => {
        io.stderr(text);
      },
    });
  addJsonOption(program);
  registerDaemonCommand(program, io);
  registerProjectsCommand(program, io);
  registerProfilesCommand(program, io);
  registerDoctorCommand(program, io);
  registerIngestCommand(program, io);
  registerStatusCommand(program, io);
  registerStartCommand(program, io);
  registerStopCommand(program, io);
  registerSessionsCommand(program, io);
  registerShowCommand(program, io);
  registerNoteCommand(program, io);
  registerBugCommand(program, io);
  registerFlagCommand(program, io);
  registerScreenshotCommand(program, io);
  registerSnapshotCommand(program, io);
  registerEventsCommand(program, io);
  registerContextCommand(program, io);
  registerPromptCommand(program, io);
  return program;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const json = argvWantsJson(argv);
  try {
    await createProgram(io).parseAsync(argv);
    return 0;
  } catch (error) {
    return handleError(error, io, json);
  }
}
