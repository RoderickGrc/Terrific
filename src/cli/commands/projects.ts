import type { Command } from 'commander';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, formatAgo, printColumns, printJson, wantsJson } from '../output.ts';

export function registerProjectsCommand(program: Command, io: CliIo): void {
  addJsonOption(program.command('projects').description('List known projects')).action(
    async (_opts, cmd: Command) => {
      const ctx = createCliContext(io);
      const { client } = await ctx.connect();
      const projects = await client.listProjects();
      if (wantsJson(cmd)) {
        printJson(io, projects);
        return;
      }
      const now = new Date();
      printColumns(
        io,
        projects.map((project) => [project.id, project.cwd, formatAgo(project.lastOpenedAt, now)]),
      );
    },
  );
}
