export type ErrorCode =
  | 'USAGE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'ENDPOINT_CLOSED'
  | 'INTERNAL';

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
