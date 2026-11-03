#!/usr/bin/env node
// Everything loads lazily so `--version` and short commands stay fast.
const [{ runCli }, { processIo }] = await Promise.all([
  import('./cli/program.ts'),
  import('./cli/io.ts'),
]);

const argv = process.argv;
// The TUI opens here once it exists; until then no arguments shows the help.
const args = argv.length <= 2 ? [...argv, '--help'] : argv;
process.exitCode = await runCli(args, processIo());
