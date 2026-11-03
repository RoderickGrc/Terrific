import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { agentPrompt, bugsAndErrors, endpointInstructions } from './copy-payloads.ts';
import type { EventInput, TerrificEvent } from './events.ts';
import type { SessionSummaryInfo } from './session.ts';

function event(input: EventInput, t: number): TerrificEvent {
  return { id: `ev_${t}`, seq: t, at: '2026-03-01T10:00:00.000Z', t, ...input };
}

const session: SessionSummaryInfo = {
  id: 'ab12cd34ef',
  name: 'login check',
  status: 'stopped',
  startedAt: '2026-03-01T10:00:00.000Z',
  stoppedAt: '2026-03-01T10:02:15.000Z',
  projectPath: 'D:\\work\\demo-app',
  setup: {
    target: 'browser',
    url: 'http://app.test/login',
    profile: 'testing',
    record: { actions: true, network: true, console: true },
    endpoint: 'api',
  },
  legacy: false,
};

const events: TerrificEvent[] = [
  event({ kind: 'lifecycle', state: 'started' }, 0),
  event(
    {
      kind: 'action',
      action: 'click',
      target: { label: 'Save' },
      masked: false,
    },
    1000,
  ),
  event(
    {
      kind: 'network',
      phase: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'http://app.test/api/missing',
      status: 404,
      durationMs: 12,
    },
    2000,
  ),
  event({ kind: 'console', level: 'error', text: 'boom' }, 2500),
  event({ kind: 'bug', text: null, author: 'tester' }, 4000),
  event({ kind: 'flag', text: 'watch this', author: 'tester' }, 5000),
];

const files = {
  folder: 'D:\\work\\demo-app\\.terrific\\sessions\\s1',
  context: 'D:\\work\\demo-app\\.terrific\\sessions\\s1\\context.txt',
  events: 'D:\\work\\demo-app\\.terrific\\sessions\\s1\\events.jsonl',
  screenshots: 'D:\\work\\demo-app\\.terrific\\sessions\\s1\\screenshots',
  contextBytes: 14400,
};

const endpoint = {
  name: 'api',
  url: 'http://127.0.0.1:4569/ingest/ing_exampletoken0000000001',
  state: 'open' as const,
};

const input = { session, events, projectId: 'k2m8q4zx', files, endpoint };

test('agentPrompt lists marks, failures, files and targeted reads', () => {
  equal(
    agentPrompt(input),
    [
      'Terrific QA session ab12cd34ef "login check"',
      'Project: D:\\work\\demo-app (id k2m8q4zx)',
      'Recorded 2026-03-01T10:00:00.000Z to 2026-03-01T10:02:15.000Z (2m 15s), starting at app.test/login',
      'Ingest endpoint "api": http://127.0.0.1:4569/ingest/ing_exampletoken0000000001 (still open)',
      '5 events: 1 action, 1 network, 1 console, 1 bug, 1 flag. 1 bug to review · 2 errors · 1 flagged',
      '',
      'Bugs and flags:',
      '- bug at 00:04.0: Bug reported',
      '- flag at 00:05.0: watch this',
      '',
      'Failed requests:',
      '- GET http://app.test/api/missing 404',
      '',
      'Errors:',
      '- 00:02.5 console: boom',
      '',
      'Files:',
      '- Context, read this first: D:\\work\\demo-app\\.terrific\\sessions\\s1\\context.txt (14.1 KB, ~3.6k tokens)',
      '- Raw events: D:\\work\\demo-app\\.terrific\\sessions\\s1\\events.jsonl',
      '',
      'Targeted reads:',
      '  terrific events ab12cd34ef --type bug,flag,note',
      '  terrific events ab12cd34ef --around 00:04 --window 10s',
    ].join('\n'),
  );
});

test('bugsAndErrors includes the 10s window and the context path', () => {
  equal(
    bugsAndErrors(input),
    [
      'Bugs and errors in Terrific session ab12cd34ef "login check"',
      '',
      'BUG at 00:04.0: Bug reported',
      '  00:01.0  click "Save"',
      '  00:02.0  GET http://app.test/api/missing 404',
      '  00:02.5  console error: boom',
      '',
      'FLAG at 00:05.0: watch this',
      '  00:01.0  click "Save"',
      '  00:02.0  GET http://app.test/api/missing 404',
      '  00:02.5  console error: boom',
      '',
      'FAILED GET http://app.test/api/missing 404',
      'ERROR boom',
      '',
      'Full context: D:\\work\\demo-app\\.terrific\\sessions\\s1\\context.txt',
    ].join('\n'),
  );
});

test('endpointInstructions uses POSIX single quotes and the ingest fields', () => {
  equal(
    endpointInstructions(endpoint),
    [
      'Terrific ingest endpoint "api" (open)',
      'POST http://127.0.0.1:4569/ingest/ing_exampletoken0000000001',
      '',
      'JSON body: message (required), source, diagnosticSlug, level (debug, info, warn, error), timestamp, data',
      '',
      'Example:',
      'curl -X POST \'http://127.0.0.1:4569/ingest/ing_exampletoken0000000001\' -H \'Content-Type: application/json\' -d \'{"message":"hello from my app","source":"server.ts:12"}\'',
    ].join('\n'),
  );
});

test('bugsAndErrors empty session uses the nothing-reported line', () => {
  equal(
    bugsAndErrors({
      ...input,
      events: [],
      session: { ...session, name: null, setup: { ...session.setup, target: 'none', url: '' } },
    }),
    [
      'Bugs and errors in Terrific session ab12cd34ef',
      '',
      'Nothing reported and no errors captured.',
      '',
      'Full context: D:\\work\\demo-app\\.terrific\\sessions\\s1\\context.txt',
    ].join('\n'),
  );
});
