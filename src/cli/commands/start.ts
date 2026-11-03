import { type Command, CommanderError } from 'commander';
import type { EndpointView } from '../../core/api.ts';
import { parseNewArgv } from '../../core/new-command.ts';
import type { EndpointOption, ProfileOption } from '../../core/setup.ts';
import { createCliContext } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addJsonOption, printJson, printLine, wantsJson } from '../output.ts';

const CLEAN_PROFILES: ProfileOption[] = [
  { slug: 'clean', label: 'Clean browser', detail: 'fresh storage, nothing saved' },
];

function toEndpointOption(endpoint: EndpointView): EndpointOption {
  const parsed = endpoint.lastEventAt === null ? Number.NaN : Date.parse(endpoint.lastEventAt);
  return {
    name: endpoint.name,
    state: endpoint.state,
    eventCount: endpoint.eventCount,
    lastEventAt: Number.isFinite(parsed) ? parsed : null,
  };
}

function rejectProblems(io: CliIo, tokens: ReturnType<typeof parseNewArgv>['tokens']): void {
  let found = false;
  for (const token of tokens) {
    if (token.problem === undefined) continue;
    found = true;
    io.stderr(`${token.text}  ${token.problem.message}\n`);
  }
  if (found) throw new CommanderError(2, 'startUsage', '');
}

export function registerStartCommand(program: Command, io: CliIo): void {
  // `--no-browser` and friends are /new tokens, not Commander options. Unknown
  // options stay in `cmd.args`. passThroughOptions is off so `--json` still binds.
  addJsonOption(
    program
      .command('start')
      .description('Start recording and return immediately')
      .argument('[tokens...]')
      .allowUnknownOption(true)
      .allowExcessArguments(true),
  ).action(async (_tokens: string[], _opts, cmd: Command) => {
    const ctx = createCliContext(io);
    const project = await ctx.project();
    const { client } = await ctx.connect();
    const [settings, endpoints] = await Promise.all([
      client.getSettings(project.id),
      client.listEndpoints(project.id),
    ]);
    const parsed = parseNewArgv(cmd.args, {
      last: settings.lastSetup,
      profiles: CLEAN_PROFILES,
      endpoints: endpoints.map(toEndpointOption),
    });
    rejectProblems(io, parsed.tokens);
    const session = await client.startSession(project.id, {
      setup: parsed.setup,
      name: parsed.name === '' ? null : parsed.name,
    });
    await client.patchSettings(project.id, { lastSetup: parsed.setup });
    if (wantsJson(cmd)) {
      printJson(io, session);
      return;
    }
    printLine(io, `session ${session.id} ${session.status}`);
    printLine(io, `folder ${session.folder}`);
    if (session.endpoint !== null) printLine(io, `ingest ${session.endpoint.url}`);
  });
}
