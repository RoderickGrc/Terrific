#!/usr/bin/env node
// Everything loads lazily so `--version` and short commands stay fast.
const argv = process.argv;
const bare = argv.length <= 2;
const { processIo } = await import('./cli/io.ts');
const io = processIo();

if (bare && process.stdin.isTTY && process.stdout.isTTY) {
  const { runTui } = await import('./tui/run.ts');
  process.exitCode = await runTui(io);
} else {
  // Without a terminal (an agent or a pipe) the bare command prints the help instead of waiting for keys.
  const { runCli } = await import('./cli/program.ts');
  process.exitCode = await runCli(bare ? [...argv, '--help'] : argv, io);
}
