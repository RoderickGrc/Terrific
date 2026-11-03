import type { Command } from 'commander';
import type { SessionEventsQuery } from '../../client/daemon-client.ts';
import { TerrificError } from '../../core/errors.ts';
import { formatEventLine } from '../../core/event-line.ts';
import { parseEventQuery, queryEvents } from '../../core/event-query.ts';
import type { TerrificEvent } from '../../core/events.ts';
import { isStoredEvent } from '../../core/session.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';
import { isAbort } from '../pick-session.ts';

const STOP_STATES = new Set(['stopped', 'interrupted', 'browser-closed']);

function readLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new TerrificError('USAGE', '--limit must be a non-negative integer.');
  }
  return value;
}

function toQuery(opts: {
  type?: string;
  around?: string;
  window?: string;
  at?: string;
  bodies?: boolean;
  limit?: string;
}): SessionEventsQuery {
  return {
    type: opts.type,
    around: opts.around,
    window: opts.window,
    at: opts.at,
    bodies: opts.bodies === true ? true : undefined,
    limit: readLimit(opts.limit),
  };
}

function parseStreamEvent(data: string): TerrificEvent | undefined {
  try {
    const value: unknown = JSON.parse(data);
    return isStoredEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function matchesQuery(event: TerrificEvent, opts: { type?: string }): boolean {
  if (opts.type === undefined) return true;
  const parsed = parseEventQuery(new URLSearchParams({ type: opts.type }));
  return queryEvents([event], parsed).length > 0;
}

function isStop(event: TerrificEvent): boolean {
  return event.kind === 'lifecycle' && STOP_STATES.has(event.state);
}

function emit(io: CliIo, json: boolean, event: TerrificEvent): void {
  if (json) printJson(io, event);
  else printLine(io, formatEventLine(event));
}

export function registerEventsCommand(program: Command, io: CliIo): void {
  addJsonOption(
    program
      .command('events')
      .description('Read session events')
      .argument('<id>')
      .option('--type <list>', 'Event kinds, or errors')
      .option('--around <mm:ss>', 'Center a time window on this offset')
      .option('--window <dur>', 'Window size around --around, such as 10s')
      .option('--at <mm:ss>', 'Events near this offset, with bodies')
      .option('--bodies', 'Include request and response bodies')
      .option('--limit <n>', 'Maximum events to print')
      .option('--follow', 'Stream new events until the session stops'),
  ).action(
    async (
      id: string,
      opts: {
        type?: string;
        around?: string;
        window?: string;
        at?: string;
        bodies?: boolean;
        limit?: string;
        follow?: boolean;
      },
      cmd: Command,
    ) => {
      const ctx = createCliContext(io);
      const { client } = await ctx.connect();
      const query = toQuery(opts);
      const json = wantsJson(cmd);
      if (opts.follow !== true) {
        const events = await client.queryEvents(id, query);
        if (json) printJson(io, events);
        else for (const event of events) printLine(io, formatEventLine(event));
        return;
      }
      const session = await client.getSession(id);
      const ac = new AbortController();
      const onSig = (): void => {
        ac.abort();
      };
      process.on('SIGINT', onSig);
      try {
        // Subscribe before the snapshot so a mark cannot land in the gap.
        const stream = session.status === 'recording' ? client.sessionStream(id, ac.signal) : null;
        const first = stream?.next();
        const events = await client.queryEvents(id, query);
        const seen = new Set<string>();
        for (const event of events) {
          seen.add(event.id);
          emit(io, json, event);
        }
        if (stream === null || first === undefined) return;
        let next = await first;
        while (!next.done) {
          const event = parseStreamEvent(next.value.data);
          if (event !== undefined && !seen.has(event.id)) {
            seen.add(event.id);
            if (matchesQuery(event, opts)) emit(io, json, event);
            if (isStop(event)) break;
          }
          next = await stream.next();
        }
      } catch (error) {
        if (!isAbort(error) && !ac.signal.aborted) throw error;
      } finally {
        process.off('SIGINT', onSig);
      }
    },
  );
}
