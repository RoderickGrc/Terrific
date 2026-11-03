export const ERROR_CODES = [
  'USAGE',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_INPUT',
  'ENDPOINT_CLOSED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

export class TerrificError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'TerrificError';
    this.code = code;
    this.exitCode = code === 'USAGE' ? 2 : 1;
  }
}

export function isTerrificError(value: unknown): value is TerrificError {
  return value instanceof TerrificError;
}
