import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ContextResponse,
  PromptResponse,
  SessionDetail,
  SessionListItem,
  SessionView,
} from '../core/api.ts';
import type { ContextOnly } from '../core/context-export.ts';
import { renderContext } from '../core/context-export.ts';
import { agentPrompt, bugsAndErrors } from '../core/copy-payloads.ts';
import { TerrificError } from '../core/errors.ts';
import { approxTokens } from '../core/format.ts';
import { copySetup } from '../core/setup.ts';
import { sessionStats, verdictLine } from '../core/stats.ts';
import type { IngestService } from './ingest-service.ts';
import type { CatalogEntry } from './session-catalog.ts';

export async function fileBytes(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function toSessionView(
  entry: CatalogEntry,
  ingest: IngestService,
): Promise<SessionView> {
  let endpoint = null;
  if (entry.record?.endpoint !== null && entry.record?.endpoint !== undefined) {
    endpoint = await ingest.findByToken(entry.record.endpoint.token);
  }
  return {
    id: entry.summary.id,
    name: entry.summary.name,
    status: entry.summary.status,
    startedAt: entry.summary.startedAt,
    stoppedAt: entry.summary.stoppedAt,
    projectId: entry.projectId ?? '',
    projectPath: entry.summary.projectPath,
    setup: copySetup(entry.summary.setup),
    endpoint,
    legacy: entry.legacy,
    folder: entry.paths.folder,
    files: {
      context: entry.paths.contextFile,
      events: entry.paths.eventsFile,
      screenshots: entry.paths.screenshotsDir,
    },
  };
}

function wallDuration(entry: CatalogEntry, fallback: number, now: () => Date): number {
  const start = Date.parse(entry.summary.startedAt);
  if (Number.isNaN(start)) return fallback;
  if (entry.summary.stoppedAt !== null) {
    const stop = Date.parse(entry.summary.stoppedAt);
    if (!Number.isNaN(stop)) return Math.max(0, stop - start);
  }
  return Math.max(0, now().getTime() - start);
}

export async function toListItem(
  entry: CatalogEntry,
  pinned: ReadonlySet<string>,
  now: () => Date,
): Promise<SessionListItem> {
  const events = await entry.loadEvents();
  const stats = sessionStats(events, {
    initialUrl: entry.summary.setup.url === '' ? undefined : entry.summary.setup.url,
  });
  let bugs = 0;
  let flags = 0;
  const marks: SessionListItem['marks'] = [];
  for (const mark of stats.marks) {
    if (mark.kind === 'bug') bugs += 1;
    else flags += 1;
    marks.push({ t: mark.t, kind: mark.kind });
  }
  return {
    id: entry.summary.id,
    name: entry.summary.name,
    status: entry.summary.status,
    startedAt: entry.summary.startedAt,
    stoppedAt: entry.summary.stoppedAt,
    durationMs: wallDuration(entry, stats.durationMs, now),
    total: stats.total,
    bugs,
    flags,
    errors: stats.failedRequests.length + stats.consoleErrors.length + stats.ingestErrors.length,
    legacy: entry.legacy,
    pinned: pinned.has(entry.summary.id),
    marks,
  };
}

export async function toDetail(entry: CatalogEntry, ingest: IngestService): Promise<SessionDetail> {
  const events = await entry.loadEvents();
  const stats = sessionStats(events, {
    initialUrl: entry.summary.setup.url === '' ? undefined : entry.summary.setup.url,
  });
  const written = await fileBytes(entry.paths.contextFile);
  const legacyBytes =
    entry.paths.legacyContextFile === null ? null : await fileBytes(entry.paths.legacyContextFile);
  const contextBytes = written ?? legacyBytes;
  return {
    ...(await toSessionView(entry, ingest)),
    stats,
    verdict: verdictLine(stats),
    contextBytes,
  };
}

export async function writeContext(
  entry: CatalogEntry,
  only: ContextOnly[] | undefined,
): Promise<ContextResponse> {
  const events = await entry.loadEvents();
  const text = renderContext({ session: entry.summary, events, only });
  await mkdir(dirname(entry.paths.contextFile), { recursive: true });
  await writeFile(entry.paths.contextFile, text, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  return { path: entry.paths.contextFile, bytes, approxTokens: approxTokens(bytes) };
}

async function ensureContext(entry: CatalogEntry): Promise<number> {
  const existing = await fileBytes(entry.paths.contextFile);
  if (existing !== null) return existing;
  return (await writeContext(entry, undefined)).bytes;
}

export async function buildPrompt(
  entry: CatalogEntry,
  ingest: IngestService,
  kind: 'agent' | 'bugs' | 'full',
): Promise<PromptResponse> {
  if (kind === 'full') {
    await ensureContext(entry);
    return { text: await readFile(entry.paths.contextFile, 'utf8') };
  }
  const bytes = await ensureContext(entry);
  const events = await entry.loadEvents();
  const view = await toSessionView(entry, ingest);
  const input = {
    session: entry.summary,
    events,
    projectId: entry.projectId ?? '',
    files: {
      folder: entry.paths.folder,
      context: entry.paths.contextFile,
      events: entry.paths.eventsFile,
      screenshots: entry.paths.screenshotsDir,
      contextBytes: bytes,
    },
    endpoint: view.endpoint,
  };
  if (kind === 'bugs') return { text: bugsAndErrors(input) };
  return { text: agentPrompt(input) };
}

export function refuseLegacy(): never {
  throw new TerrificError('CONFLICT', 'Legacy sessions are read only.');
}

export function refuseRunning(): never {
  throw new TerrificError('CONFLICT', 'Stop the session first.');
}
