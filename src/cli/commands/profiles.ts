import type { Command } from 'commander';
import type { ProfileView } from '../../core/api.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printColumns, printJson, wantsJson } from '../output.ts';

export function registerProfilesCommand(program: Command, io: CliIo): void {
  addJsonOption(program.command('profiles').description('List browser profiles')).action(
    async (_opts, cmd: Command) => {
      const ctx = createCliContext(io);
      const { client } = await ctx.connect();
      const profiles = await client.listProfiles();
      if (wantsJson(cmd)) {
        printJson(io, profiles);
        return;
      }
      printColumns(io, profiles.map(profileRow));
    },
  );
}

function profileRow(profile: ProfileView): string[] {
  const blocked = profile.blockedReason === null ? '' : `blocked: ${profile.blockedReason}`;
  return [`@${profile.slug}`, profile.label, profile.detail, blocked];
}
