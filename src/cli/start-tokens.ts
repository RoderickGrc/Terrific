const START = 'start';

// Commander still consumes `--json`; everything else after `start` goes to parseNewArgv.
export function startArgvTokens(argv: string[]): string[] {
  const index = argv.indexOf(START);
  if (index === -1) return [];
  return argv.slice(index + 1).filter((part) => part !== '--json');
}
