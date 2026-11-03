import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { NewContext, Token } from './new-command.ts';
import { formatNewCommand, parseNewArgv, parseNewLine, tokenizeNewArgs } from './new-command.ts';
import type { EndpointOption, SessionSetup } from './setup.ts';

const last: SessionSetup = {
  target: 'browser',
  url: 'https://app.example.com/',
  profile: 'testing',
  record: { actions: true, network: true, console: true },
  endpoint: 'app',
};

const profiles = [
  { slug: 'testing', label: 'Testing', detail: 'daily browser' },
  { slug: 'work', label: 'Work', detail: 'office profile' },
  { slug: 'clean', label: 'Clean', detail: 'temporary profile' },
  {
    slug: 'chrome',
    label: 'Chrome',
    detail: 'system Chrome',
    blockedReason: 'Chrome blocks automation of its default profile',
  },
];

const endpoints: EndpointOption[] = [
  { name: 'app', state: 'open', eventCount: 12, lastEventAt: 50 },
  { name: 'worker', state: 'open', eventCount: 2, lastEventAt: 10 },
  { name: 'old', state: 'closed', eventCount: 8, lastEventAt: 90 },
];

function ctx(overrides: Partial<NewContext> = {}): NewContext {
  return {
    last: overrides.last ?? last,
    profiles: overrides.profiles ?? profiles,
    endpoints: overrides.endpoints ?? endpoints,
  };
}

function parse(line: string, context?: NewContext) {
  return parseNewLine(line, context ?? ctx());
}

function problemOf(tokens: Token[], text: string) {
  return tokens.find((token) => token.text === text)?.problem;
}

test('grammar table examples from design.md section 2', () => {
  const rows: { line: string; check: (parsed: ReturnType<typeof parse>) => void }[] = [
    {
      line: 'localhost:5173',
      check: (parsed) => {
        equal(parsed.setup.url, 'http://localhost:5173');
        equal(parsed.setup.target, 'browser');
        equal(parsed.sources.url, 'localhost:5173');
        equal(parsed.sources.target, 'URL');
      },
    },
    {
      line: 'app.example.com/login',
      check: (parsed) => {
        equal(parsed.setup.url, 'https://app.example.com/login');
        equal(parsed.tokens[0]?.kind, 'url');
      },
    },
    {
      line: 'pooling check',
      check: (parsed) => {
        equal(parsed.name, 'pooling check');
        equal(parsed.setup.target, 'none');
        equal(parsed.sources.target, 'name without URL');
        equal(parsed.sources.name, 'pooling check');
      },
    },
    {
      line: '"api.v2"',
      check: (parsed) => {
        equal(parsed.name, 'api.v2');
        equal(parsed.tokens[0]?.kind, 'name');
        equal(parsed.tokens[0]?.quoted, true);
        equal(parsed.setup.target, 'none');
      },
    },
    {
      line: '@testing',
      check: (parsed) => {
        equal(parsed.setup.profile, 'testing');
        equal(parsed.setup.target, 'browser');
        equal(parsed.sources.target, 'browser options');
        equal(parsed.sources.profile, '@testing');
      },
    },
    {
      line: '#app',
      check: (parsed) => {
        equal(parsed.setup.endpoint, 'app');
        equal(parsed.createsEndpoint, false);
        equal(parsed.sources.endpoint, '#app');
      },
    },
    {
      line: '--no-browser',
      check: (parsed) => {
        equal(parsed.setup.target, 'none');
        equal(parsed.setup.url, '');
        equal(parsed.sources.target, '--no-browser');
      },
    },
    {
      line: '--no-actions --no-network --no-console',
      check: (parsed) => {
        deepEqual(parsed.setup.record, { actions: false, network: false, console: false });
        equal(parsed.setup.target, 'browser');
        equal(parsed.sources.record, '--no-actions --no-network --no-console');
      },
    },
    {
      line: '--no-ingest',
      check: (parsed) => {
        equal(parsed.setup.endpoint, null);
        equal(parsed.sources.endpoint, '--no-ingest');
        equal(parsed.setup.target, 'browser');
      },
    },
  ];
  for (const row of rows) row.check(parse(row.line));
});

test('problem messages listed while typing, verbatim', () => {
  const rows: [string, string, Token['problem']][] = [
    [
      '--no-con',
      '--no-con',
      { severity: 'incomplete', message: 'incomplete flag, Tab completes it' },
    ],
    ['@te', '@te', { severity: 'incomplete', message: 'incomplete profile, Tab completes it' }],
    ['@', '@', { severity: 'incomplete', message: 'type a profile name' }],
    ['@missing', '@missing', { severity: 'invalid', message: 'no profile called "missing"' }],
    [
      '@chrome',
      '@chrome',
      { severity: 'invalid', message: 'Chrome blocks automation of its default profile' },
    ],
    [
      'htp://x',
      'htp://x',
      { severity: 'invalid', message: 'not a valid URL, read as part of the name' },
    ],
    [
      'http:',
      'http:',
      { severity: 'invalid', message: 'not a valid URL, read as part of the name' },
    ],
    ['www.', 'www.', { severity: 'invalid', message: 'not a valid URL, read as part of the name' }],
    [
      '--mobile',
      '--mobile',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--video',
      '--video',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--tablet',
      '--tablet',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--hd',
      '--hd',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--fhd',
      '--fhd',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--dynamic',
      '--dynamic',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    [
      '--viewport-wide',
      '--viewport-wide',
      {
        severity: 'invalid',
        message: 'terrific records no video and always uses the dynamic viewport',
      },
    ],
    ['--xyz', '--xyz', { severity: 'invalid', message: 'unknown flag --xyz' }],
    ['#', '#', { severity: 'incomplete', message: 'type an endpoint name' }],
    [
      '#Nope_1',
      '#Nope_1',
      {
        severity: 'invalid',
        message: 'endpoint names use lowercase letters, digits and dashes',
      },
    ],
    [
      'localhost:5173 app.example.com',
      'app.example.com',
      { severity: 'invalid', message: 'only one URL per session, read as part of the name' },
    ],
    ['"open', '"open', { severity: 'incomplete', message: 'closing quote missing' }],
    [
      'localhost:5173 --no-browser',
      'localhost:5173',
      { severity: 'invalid', message: 'ignored with --no-browser' },
    ],
    ['@work --no-browser', '@work', { severity: 'invalid', message: 'ignored with --no-browser' }],
    [
      '--no-console --no-browser',
      '--no-console',
      { severity: 'invalid', message: 'ignored with --no-browser' },
    ],
    [
      '#app #worker',
      '#worker',
      { severity: 'invalid', message: 'one ingest endpoint per session, app is already set' },
    ],
  ];
  for (const [line, text, expected] of rows) {
    deepEqual(problemOf(parse(line).tokens, text), expected, line);
  }
});

test('target rule cases', () => {
  const noneLast = ctx({ last: { ...last, target: 'none', url: 'https://kept.example/' } });
  equal(parse('', noneLast).setup.target, 'none');
  equal(parse('').setup.target, 'browser');
  equal(parse('').sources.target, 'last setup');
  equal(parse('notes only').setup.target, 'none');
  equal(parse('localhost:5173').setup.target, 'browser');
  equal(parse('@work').setup.target, 'browser');
  equal(parse('--no-actions').setup.target, 'browser');
  const ignored = parse('https://x.test --no-browser');
  equal(ignored.setup.target, 'none');
  equal(ignored.setup.url, '');
  deepEqual(problemOf(ignored.tokens, 'https://x.test'), {
    severity: 'invalid',
    message: 'ignored with --no-browser',
  });
});

test('name-only and --no-browser keep last profile and record', () => {
  const previous = ctx({
    last: {
      ...last,
      profile: 'work',
      record: { actions: false, network: true, console: false },
    },
  });
  for (const line of ['just a name', '--no-browser @clean --no-network']) {
    const parsed = parse(line, previous);
    equal(parsed.setup.profile, 'work');
    deepEqual(parsed.setup.record, { actions: false, network: true, console: false });
    equal(parsed.sources.profile, 'last setup');
    equal(parsed.sources.record, 'last setup');
    equal(parsed.setup.url, '');
  }
});

test('invalid and incomplete tokens do not change the setup except as name words', () => {
  const parsed = parse('@te --no-con @chrome htp://x leftover');
  equal(parsed.setup.profile, 'testing');
  deepEqual(parsed.setup.record, last.record);
  equal(parsed.name, 'htp://x leftover');
  equal(parsed.setup.target, 'none');
  equal(parsed.sources.target, 'name without URL');
});

test('endpoint defaults', () => {
  const openLast = parse('');
  equal(openLast.setup.endpoint, 'app');
  equal(openLast.sources.endpoint, 'last used');
  equal(openLast.createsEndpoint, false);

  const closedLast = parse('', ctx({ last: { ...last, endpoint: 'old' } }));
  equal(closedLast.setup.endpoint, 'app');
  equal(closedLast.sources.endpoint, 'most recent open endpoint');

  const noneOpen = ctx({
    last: { ...last, endpoint: 'old' },
    endpoints: [{ name: 'old', state: 'closed', eventCount: 1, lastEventAt: 1 }],
  });
  equal(parse('localhost:5173', noneOpen).setup.endpoint, null);
  equal(parse('localhost:5173', noneOpen).createsEndpoint, false);
  const noBrowserMain = parse('--no-browser', noneOpen);
  equal(noBrowserMain.setup.endpoint, 'main');
  equal(noBrowserMain.sources.endpoint, 'default without browser');
  equal(noBrowserMain.createsEndpoint, true);

  const mainClosed = ctx({
    last: { ...last, endpoint: null },
    endpoints: [{ name: 'main', state: 'closed', eventCount: 0, lastEventAt: null }],
  });
  const reuseMain = parse('notes', mainClosed);
  equal(reuseMain.setup.endpoint, 'main');
  equal(reuseMain.createsEndpoint, false);
  equal(reuseMain.sources.endpoint, 'default without browser');

  const noIngest = parse('--no-browser --no-ingest', noneOpen);
  equal(noIngest.setup.endpoint, null);
  equal(noIngest.sources.endpoint, '--no-ingest');

  const explicitClosed = parse('#old');
  equal(explicitClosed.setup.endpoint, 'old');
  equal(explicitClosed.createsEndpoint, false);

  const created = parse('#fresh');
  equal(created.setup.endpoint, 'fresh');
  equal(created.createsEndpoint, true);

  const second = parse('#app #fresh');
  equal(second.setup.endpoint, 'app');
  equal(second.createsEndpoint, false);
  deepEqual(problemOf(second.tokens, '#fresh'), {
    severity: 'invalid',
    message: 'one ingest endpoint per session, app is already set',
  });
});

test('token start and end slice the parser input for line and argv', () => {
  const line = `localhost:5173  "pooling interval"  @testing  #app`;
  const fromLine = parse(line);
  for (const token of fromLine.tokens) {
    equal(line.slice(token.start, token.end), token.text);
  }
  const argv = ['localhost:5173', 'pooling interval', '@testing', '#app'];
  const joined = argv.join(' ');
  const fromArgv = parseNewArgv(argv, ctx());
  equal(fromArgv.name, 'pooling interval');
  equal(fromArgv.tokens[1]?.quoted, true);
  for (const token of fromArgv.tokens) {
    equal(joined.slice(token.start, token.end), token.text, token.text);
  }
  const raw = tokenizeNewArgs(`'still name' leftover`);
  equal(raw[0]?.quoted, true);
  equal(raw[0]?.open, false);
});

test('quoted text is always a name and unclosed quotes stay incomplete', () => {
  const parsed = parse(`localhost:5173 "looks @like #tokens" 'and --flags'`);
  equal(parsed.name, 'looks @like #tokens and --flags');
  equal(parsed.setup.url, 'http://localhost:5173');
  const open = parse(`notes "still`);
  equal(open.name, 'notes still');
  deepEqual(open.tokens[1]?.problem, {
    severity: 'incomplete',
    message: 'closing quote missing',
  });
});

test('formatNewCommand round-trips a table of setups including special names', () => {
  const rows: { setup: SessionSetup; name: string }[] = [
    {
      setup: {
        target: 'browser',
        url: 'http://localhost:5173/',
        profile: 'testing',
        record: { actions: true, network: true, console: true },
        endpoint: 'app',
      },
      name: 'pooling interval check',
    },
    {
      setup: {
        target: 'browser',
        url: 'https://app.example.com/login',
        profile: 'work',
        record: { actions: false, network: true, console: false },
        endpoint: 'worker',
      },
      name: 'api.v2',
    },
    {
      setup: {
        target: 'browser',
        url: 'https://app.example.com/',
        profile: 'clean',
        record: { actions: true, network: true, console: true },
        endpoint: 'app',
      },
      name: '@not-a-profile',
    },
    {
      setup: {
        target: 'none',
        url: '',
        profile: 'testing',
        record: { actions: true, network: true, console: true },
        endpoint: 'main',
      },
      name: 'backend notes',
    },
    {
      setup: {
        target: 'none',
        url: '',
        profile: 'testing',
        record: { actions: false, network: false, console: true },
        endpoint: null,
      },
      name: 'localhost:5173',
    },
  ];
  for (const row of rows) {
    const formatted = formatNewCommand(row.setup, row.name);
    const parsed = parseNewLine(formatted.slice('/new '.length), ctx({ last: row.setup }));
    deepEqual(parsed.setup, row.setup, formatted);
    equal(parsed.name, row.name, formatted);
  }
});
