import { getRandomValues } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import { randomId } from '../core/ids.ts';

function tmpName(path: string): string {
  const suffix = randomId(12, (bytes) => getRandomValues(new Uint8Array(bytes)));
  return join(dirname(path), `${basename(path)}.${suffix}.tmp`);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function replaceFile(tmp: string, dest: string): Promise<void> {
  try {
    await rename(tmp, dest);
  } catch (error) {
    // Windows cannot rename onto an existing file.
    if (!isErrno(error, 'EEXIST') && !isErrno(error, 'EPERM')) throw error;
    await unlink(dest);
    await rename(tmp, dest);
  }
}

export async function readJsonFile<T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TerrificError('INTERNAL', `The file "${basename(path)}" is not valid JSON.`);
  }
  if (!guard(parsed)) {
    throw new TerrificError('INTERNAL', `The file "${basename(path)}" has an invalid shape.`);
  }
  return parsed;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tmpName(path);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, body, 'utf8');
  try {
    await replaceFile(tmp, path);
  } catch (error) {
    try {
      await unlink(tmp);
    } catch {
      // Best-effort cleanup of the temp file after a failed replace.
    }
    throw error;
  }
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendJsonLines(path, [value]);
}

// One write per batch keeps a batch contiguous in the file and avoids a syscall per event.
export async function appendJsonLines(path: string, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const text = values.map((value) => `${JSON.stringify(value)}\n`).join('');
  await writeFile(path, text, { encoding: 'utf8', flag: 'a' });
}

export async function readJsonLines<T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<{ items: T[]; skipped: number }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return { items: [], skipped: 0 };
    throw error;
  }
  const items: T[] = [];
  let skipped = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (guard(parsed)) {
        items.push(parsed);
        continue;
      }
    } catch {
      // Invalid or a trailing partial line left by a crash mid-append.
    }
    skipped += 1;
  }
  return { items, skipped };
}
