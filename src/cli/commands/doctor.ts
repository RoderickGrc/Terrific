import type { Command } from 'commander';
import { resolveDataRoot } from '../../core/data-root.ts';
import { runDoctorChecks } from '../doctor-checks.ts';
import { CliExit } from '../exit.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

export function registerDoctorCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program.command('doctor').description('Check Node, browser, profiles, data dir and daemon'),
  ).action(async (_opts, cmd: Command) => {
    const dataRoot = resolveDataRoot({
      env: io.env,
      platform: io.platform,
      homedir: io.homedir,
    });
    const checks = await runDoctorChecks(io, dataRoot);
    if (wantsJson(cmd)) {
      printJson(io, { checks });
    } else {
      for (const item of checks) {
        const status = item.ok ? 'ok' : 'problem';
        const fix = item.ok || item.fix === '' ? '' : `  ${item.fix}`;
        printLine(io, `${item.name}  ${status}  ${item.detail}${fix}`);
      }
    }
    if (checks.some((item) => !item.ok)) throw new CliExit(1);
  });
}
