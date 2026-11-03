import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLegacyReader } from '../src/store/legacy.ts';
import { foldedConvertedCount, pairedResponseCount } from '../src/store/legacy-events.ts';

const home = process.env.TERRIFIC_HOME;
const dataRoot =
  home !== undefined && home !== ''
    ? home
    : process.platform === 'win32'
      ? join(homedir(), 'Documents', '.terrific')
      : join(homedir(), '.terrific');

const reader = createLegacyReader({ dataRoot });
const stores = await reader.listStores();
let read = 0;
let failed = 0;
let converted = 0;
let skipped = 0;
let recovered = 0;
const failures: string[] = [];
const mismatches: string[] = [];
const recoveredIds: string[] = [];

for (const store of stores) {
  const sessions = await reader.listSessions(store);
  console.log(`${store.kind} ${sessions.length}`);
  for (const info of sessions) {
    try {
      const result = await reader.readSession(info);
      read += 1;
      converted += result.events.length;
      skipped += result.skipped;
      if (result.recovered) {
        recovered += 1;
        recoveredIds.push(info.id);
      }
      const legacyCount =
        result.events.length + result.skipped - pairedResponseCount(result.events);
      const convertedCount = foldedConvertedCount(result.events);
      if (legacyCount !== convertedCount) {
        mismatches.push(`${info.id} ${legacyCount} ${convertedCount}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${info.id} ${message}`);
    }
  }
}

console.log(
  `read ${read} failed ${failed} converted ${converted} skipped ${skipped} recovered ${recovered}`,
);
for (const id of recoveredIds) console.log(`recovered ${id}`);
for (const line of failures) console.log(`failed ${line}`);
for (const line of mismatches) console.log(`mismatch ${line}`);
if (failed > 0) process.exit(1);
