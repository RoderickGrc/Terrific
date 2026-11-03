import { equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import type { ErrorCode } from './errors.ts';
import { isTerrificError, TerrificError } from './errors.ts';

const EXIT_CODES: { code: ErrorCode; exitCode: number }[] = [
  { code: 'USAGE', exitCode: 2 },
  { code: 'NOT_FOUND', exitCode: 1 },
  { code: 'CONFLICT', exitCode: 1 },
  { code: 'INVALID_INPUT', exitCode: 1 },
  { code: 'ENDPOINT_CLOSED', exitCode: 1 },
  { code: 'INTERNAL', exitCode: 1 },
];

test('TerrificError maps each code to its exit code', () => {
  for (const row of EXIT_CODES) {
    const error = new TerrificError(row.code, `${row.code} happened.`);
    equal(error.code, row.code);
    equal(error.exitCode, row.exitCode);
    equal(error.name, 'TerrificError');
    equal(error.message, `${row.code} happened.`);
    ok(error instanceof Error);
    ok(isTerrificError(error));
  }
});

test('isTerrificError rejects other values', () => {
  equal(isTerrificError(new Error('no')), false);
  equal(isTerrificError({ code: 'USAGE', exitCode: 2 }), false);
  equal(isTerrificError(null), false);
  equal(isTerrificError('USAGE'), false);
});
