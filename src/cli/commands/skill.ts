import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
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

async function isTerrificSkill(dir: string): Promise<boolean> {
  try {
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8');
    return /^---\r?\n(?:.*\r?\n)*?name:\s*terrific\s*\r?\n/.test(text);
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function registerSkillCommand(program: Command, io: CliIo): void {
  program
    .command('skill')
    .description('Install the agent skill with terrific skill install [path]')
    .command('install [path]')
    .description('Install the skill into a directory (default: .agents/skills/terrific)')
    .option('--force', 'Replace an existing Terrific skill at the destination')
    .action(async (path: string | undefined, options: { force?: boolean }) => {
      const source = await skillSource();
      const destination = resolve(io.cwd, path ?? '.agents/skills/terrific');
      if (resolve(source) === destination) {
        throw new Error(`Destination is the bundled skill itself: ${destination}.`);
      }
      const replacing = options.force === true && (await exists(destination));
      if (replacing) {
        if (!(await isTerrificSkill(destination))) {
          throw new Error(
            `Destination is not a Terrific skill: ${destination}. --force only replaces a directory whose SKILL.md is named terrific.`,
          );
        }
        await rm(destination, { recursive: true, force: true });
      }
      await mkdir(dirname(destination), { recursive: true });
      try {
        await mkdir(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `Destination already exists: ${destination}. Pass --force to replace it, or choose another path.`,
          );
        }
        throw error;
      }
      // The destination is reserved above; some Node versions reject copying onto that directory.
      for (const entry of await readdir(source)) {
        await cp(join(source, entry), join(destination, entry), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      }
      printLine(io, `Skill ${replacing ? 'replaced' : 'installed'} at ${destination}`);
    });
}
