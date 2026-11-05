import { equal, match, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { CliIo } from '../io.ts';
import { runCli } from '../program.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-skill-'));
  dirs.push(dir);
  return dir;
}

function captureIo(cwd: string): CliIo & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout(text: string) {
      io.out += text;
    },
    stderr(text: string) {
      io.err += text;
    },
    cwd,
    env: {},
    platform: process.platform,
    homedir: tmpdir(),
  };
  return io;
}

async function install(cwd: string, ...args: string[]) {
  const io = captureIo(cwd);
  const code = await runCli(['node', 'terrific', 'skill', 'install', ...args], io);
  return { code, io };
}

test('skill install refuses an existing skill and --force replaces it', async () => {
  const cwd = await tempDir();
  const destination = join(cwd, 'skills', 'terrific');

  const first = await install(cwd, destination);
  equal(first.code, 0, first.io.err);
  match(first.io.out, /Skill installed at /);
  ok(existsSync(join(destination, 'references', 'validation.md')));

  await writeFile(join(destination, 'stale.md'), 'old');
  const again = await install(cwd, destination);
  equal(again.code, 1);
  match(again.io.err, /--force/);

  const forced = await install(cwd, destination, '--force');
  equal(forced.code, 0, forced.io.err);
  match(forced.io.out, /Skill replaced at /);
  ok(existsSync(join(destination, 'SKILL.md')));
  ok(!existsSync(join(destination, 'stale.md')));
});

test('skill install --force leaves a directory that is not the Terrific skill', async () => {
  const cwd = await tempDir();
  const destination = join(cwd, 'other');
  await mkdir(destination);
  await writeFile(join(destination, 'SKILL.md'), '---\nname: other\n---\n');

  const forced = await install(cwd, destination, '--force');
  equal(forced.code, 1);
  match(forced.io.err, /not a Terrific skill/);
  ok(existsSync(join(destination, 'SKILL.md')));
});

test('skill install --force into a new directory installs it', async () => {
  const cwd = await tempDir();
  const forced = await install(cwd, '--force');
  equal(forced.code, 0, forced.io.err);
  match(forced.io.out, /Skill installed at /);
  ok(existsSync(join(cwd, '.agents', 'skills', 'terrific', 'SKILL.md')));
});
