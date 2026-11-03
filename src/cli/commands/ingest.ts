import type { Command } from 'commander';
import { DEFAULT_EVENT_LIMIT } from '../../core/api.ts';
import { TerrificError } from '../../core/errors.ts';
import type { IngestEvent } from '../../core/events.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import {
  addJsonOption,
  formatAgo,
  formatClock,
  printColumns,
  printJson,
  printLine,
  wantsJson,
} from '../output.ts';

function readLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_EVENT_LIMIT;
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new TerrificError('USAGE', '--limit must be a positive integer.');
  }
  return value;
}

function isIngestEvent(event: unknown): event is IngestEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'kind' in event &&
    event.kind === 'ingest' &&
    'message' in event &&
    'level' in event &&
    'at' in event
  );
}

function printEvent(io: CliIo, event: IngestEvent): void {
  const source = event.source ?? '-';
  printLine(io, `${formatClock(event.at)}  ${event.level}  ${source}  ${event.message}`);
}

function parseStreamEvent(data: string): IngestEvent | undefined {
  try {
    const value: unknown = JSON.parse(data);
    return isIngestEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}

export function registerIngestCommand(program: Command, io: CliIo): void {
  const ingest = program.command('ingest').description('Manage ingest endpoints for this project');

  addJsonOption(
    ingest.command('up').description('Create or reopen an endpoint').argument('<name>'),
  ).action(async (name: string, _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const project = await ctx.project();
    const { client } = await ctx.connect();
    const endpoint = await client.upEndpoint(project.id, name);
    if (wantsJson(cmd)) {
      printJson(io, endpoint);
      return;
    }
    printLine(io, `${endpoint.name}  ${endpoint.url}  ${endpoint.state}`);
  });

  addJsonOption(ingest.command('down').description('Close an endpoint').argument('<name>')).action(
    async (name: string, _opts, cmd: Command) => {
      const ctx = createCliContext(io);
      const project = await ctx.project();
      const { client } = await ctx.connect();
      const endpoint = await client.downEndpoint(project.id, name);
      if (wantsJson(cmd)) {
        printJson(io, endpoint);
        return;
      }
      printLine(io, `${endpoint.name} closed`);
    },
  );

  addJsonOption(ingest.command('list').description('List endpoints of this project')).action(
    async (_opts, cmd: Command) => {
      const ctx = createCliContext(io);
      const project = await ctx.project();
      const { client } = await ctx.connect();
      const endpoints = await client.listEndpoints(project.id);
      if (wantsJson(cmd)) {
        printJson(io, endpoints);
        return;
      }
      const now = new Date();
      printColumns(
        io,
        endpoints.map((endpoint) => [
          endpoint.name,
          endpoint.url,
          endpoint.state,
          String(endpoint.eventCount),
          endpoint.lastEventAt === null ? '-' : formatAgo(endpoint.lastEventAt, now),
        ]),
      );
    },
  );

  addJsonOption(
    ingest
      .command('tail')
      .description('Show events received by an endpoint')
      .argument('<name>')
      .option('--follow', 'Stream new events until interrupted')
      .option('--limit <n>', 'Maximum events to print'),
  ).action(async (name: string, opts: { follow?: boolean; limit?: string }, cmd: Command) => {
    const ctx = createCliContext(io);
    const project = await ctx.project();
    const { client } = await ctx.connect();
    const limit = readLimit(opts.limit);
    const events = await client.endpointEvents(project.id, name, limit);
    const json = wantsJson(cmd);
    if (opts.follow === true) {
      const seen = new Set<string>();
      for (const event of events) {
        if (!isIngestEvent(event)) continue;
        seen.add(event.id);
        if (json) printJson(io, event);
        else printEvent(io, event);
      }
      const ac = new AbortController();
      const onSig = (): void => {
        ac.abort();
      };
      process.on('SIGINT', onSig);
      try {
        for await (const message of client.endpointStream(project.id, name, ac.signal)) {
          const event = parseStreamEvent(message.data);
          if (event === undefined || seen.has(event.id)) continue;
          seen.add(event.id);
          if (json) printJson(io, event);
          else printEvent(io, event);
        }
      } catch (error) {
        if (!isAbort(error) && !ac.signal.aborted) throw error;
      } finally {
        process.off('SIGINT', onSig);
      }
      return;
    }
    const ingestEvents = events.filter(isIngestEvent);
    if (json) {
      printJson(io, ingestEvents);
      return;
    }
    for (const event of ingestEvents) printEvent(io, event);
  });

  addJsonOption(
    ingest.command('rename').description('Rename an endpoint').argument('<name>').argument('<new>'),
  ).action(async (name: string, next: string, _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const project = await ctx.project();
    const { client } = await ctx.connect();
    const endpoint = await client.renameEndpoint(project.id, name, next);
    if (wantsJson(cmd)) {
      printJson(io, endpoint);
      return;
    }
    printLine(io, `${name} renamed to ${endpoint.name}`);
  });

  addJsonOption(ingest.command('rm').description('Delete an endpoint').argument('<name>')).action(
    async (name: string, _opts, cmd: Command) => {
      const ctx = createCliContext(io);
      const project = await ctx.project();
      const { client } = await ctx.connect();
      await client.removeEndpoint(project.id, name);
      if (wantsJson(cmd)) {
        printJson(io, { ok: true, name });
        return;
      }
      printLine(io, `${name} deleted`);
    },
  );
}
