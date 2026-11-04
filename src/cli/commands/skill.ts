import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import type { CliIo } from '../io.ts';
import { printLine } from '../output.ts';

async function skillSource(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, '.agents', 'skills', 'terrific');
    try {
      if ((await stat(join(candidate, 'SKILL.md'))).isFile()) return candidate;
    } catch {
      // Look in the next parent directory.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('The bundled Terrific skill could not be found.');
    dir = parent;
  }
}

export function registerSkillCommand(program: Command, io: CliIo): void {
  program
    .command('skill')
    .description('Install the agent skill with terrific skill install [path]')
    .command('install [path]')
    .description('Install the skill into a directory (default: .agents/skills/terrific)')
    .action(async (path: string | undefined) => {
      const source = await skillSource();
      const destination = resolve(io.cwd, path ?? '.agents/skills/terrific');
      await mkdir(dirname(destination), { recursive: true });
      try {
        await mkdir(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `Destination already exists: ${destination}. Choose another path or remove it first.`,
          );
        }
        throw error;
      }
      await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
      printLine(io, `Skill installed at ${destination}`);
    });
}
