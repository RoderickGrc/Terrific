import { TerrificError } from './errors.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ALPHABET_SIZE = 36;
// 252 is the largest multiple of 36 that fits in a byte, so % 36 stays unbiased.
const REJECT_AT = 256 - (256 % ALPHABET_SIZE);

export type RandomSource = (bytes: number) => Uint8Array;

export function randomId(length: number, random: RandomSource): string {
  const chars: string[] = [];
  while (chars.length < length) {
    const bytes = random(length - chars.length);
    if (bytes.length === 0) {
      throw new TerrificError('INTERNAL', 'Random source returned no bytes.');
    }
    for (const byte of bytes) {
      if (byte >= REJECT_AT) continue;
      const char = ALPHABET[byte % ALPHABET_SIZE];
      if (char === undefined) continue;
      chars.push(char);
      if (chars.length === length) break;
    }
  }
  return chars.join('');
}

export function newProjectId(random: RandomSource): string {
  return randomId(8, random);
}

export function newSessionId(random: RandomSource): string {
  return randomId(10, random);
}

export function newEventId(random: RandomSource): string {
  return `ev_${randomId(12, random)}`;
}

export function newEndpointToken(random: RandomSource): string {
  return `ing_${randomId(24, random)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function sessionFolderName(sessionId: string, startedAt: Date): string {
  const year = startedAt.getUTCFullYear();
  const month = pad2(startedAt.getUTCMonth() + 1);
  const day = pad2(startedAt.getUTCDate());
  const hour = pad2(startedAt.getUTCHours());
  const minute = pad2(startedAt.getUTCMinutes());
  const second = pad2(startedAt.getUTCSeconds());
  return `${year}-${month}-${day}_${hour}-${minute}-${second}_${sessionId}`;
}

const FOLDER_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_([a-z0-9]+)$/;

export function parseSessionFolderName(name: string): { id: string; startedAt: Date } | null {
  const match = FOLDER_NAME.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const id = match[7];
  if (id === undefined) return null;
  const startedAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    startedAt.getUTCFullYear() !== year ||
    startedAt.getUTCMonth() !== month - 1 ||
    startedAt.getUTCDate() !== day ||
    startedAt.getUTCHours() !== hour ||
    startedAt.getUTCMinutes() !== minute ||
    startedAt.getUTCSeconds() !== second
  ) {
    return null;
  }
  return { id, startedAt };
}

export function isProjectId(value: string): boolean {
  return /^[a-z0-9]{8}$/.test(value);
}

export function isSessionId(value: string): boolean {
  return /^[a-z0-9]{10}$/.test(value);
}
