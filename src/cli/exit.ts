export class CliExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super('');
    this.name = 'CliExit';
    this.exitCode = exitCode;
  }
}

export function isCliExit(value: unknown): value is CliExit {
  return value instanceof CliExit;
}
