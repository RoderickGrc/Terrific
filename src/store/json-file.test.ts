import { deepEqual, equal, match } from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { isTerrificError } from '../core/errors.ts';
import { isRecord } from '../core/validate.ts';
import { appendJsonLine, readJsonFile, readJsonLines, writeJsonFile } from './json-file.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'terrific-'));
  dirs.push(dir);
  return dir;
}

function isCount(value: unknown): value is { n: number } {
  return isRecord(value) && typeof value.n === 'number';
}

test('readJsonFile returns null when the file is missing', async () => {
  const dir = await tempDir();
  equal(await readJsonFile(join(dir, 'missing.json'), isCount), null);
});

test('readJsonFile throws INTERNAL for invalid JSON or a failed guard', async () => {
  const dir = await tempDir();
  const file = join(dir, 'broken.json');
  await writeFile(file, '{');
  try {
    await readJsonFile(file, isCount);
    throw new Error('expected INTERNAL');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) {
      equal(error.code, 'INTERNAL');
      match(error.message, /broken\.json/);
    }
  }
  await writeFile(file, '{"n":"x"}\n');
  try {
    await readJsonFile(file, isCount);
    throw new Error('expected INTERNAL');
  } catch (error) {
    equal(isTerrificError(error), true);
    if (isTerrificError(error)) equal(error.code, 'INTERNAL');
  }
});

test('writeJsonFile writes pretty JSON with a trailing newline and replaces atomically', async () => {
  const dir = await tempDir();
  const file = join(dir, 'nested', 'data.json');
  await writeJsonFile(file, { n: 1 });
  equal(await readFile(file, 'utf8'), '{\n  "n": 1\n}\n');
  await writeJsonFile(file, { n: 2 });
  deepEqual(await readJsonFile(file, isCount), { n: 2 });
});

test('readJsonLines skips invalid lines and a trailing partial line', async () => {
  const dir = await tempDir();
  const file = join(dir, 'events.jsonl');
  await writeFile(file, '{"n":1}\nnot-json\n{"n":2}\n{"n":');
  const result = await readJsonLines(file, isCount);
  deepEqual(result, { items: [{ n: 1 }, { n: 2 }], skipped: 2 });
});

test('appendJsonLine creates the file and readJsonLines treats a missing file as empty', async () => {
  const dir = await tempDir();
  const file = join(dir, 'log.jsonl');
  deepEqual(await readJsonLines(file, isCount), { items: [], skipped: 0 });
  await appendJsonLine(file, { n: 3 });
  deepEqual(await readJsonLines(file, isCount), { items: [{ n: 3 }], skipped: 0 });
});
