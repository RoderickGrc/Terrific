import type { EndpointOption, ProfileOption, SessionSetup } from './setup.ts';
import {
  copyRecord,
  copySetup,
  defaultEndpoint,
  displayUrl,
  isEndpointName,
  isUrlAttempt,
  isUrlWord,
  normalizeUrl,
} from './setup.ts';

export type TokenKind = 'url' | 'name' | 'profile' | 'endpoint' | 'flag';

export type TokenProblem = { severity: 'incomplete' | 'invalid'; message: string };

export type Token = {
  text: string;
  start: number;
  end: number;
  kind: TokenKind;
  quoted: boolean;
  problem?: TokenProblem;
};

export type RawToken = {
  text: string;
  start: number;
  end: number;
  quoted: boolean;
  open: boolean;
};

export type NewContext = {
  last: SessionSetup;
  profiles: ProfileOption[];
  endpoints: EndpointOption[];
};

export type SetupField = 'target' | 'url' | 'name' | 'profile' | 'record' | 'endpoint';

export type ParsedNew = {
  setup: SessionSetup;
  name: string;
  tokens: Token[];
  sources: Partial<Record<SetupField, string>>;
  createsEndpoint: boolean;
};

export const NEW_FLAGS = [
  '--no-browser',
  '--no-actions',
  '--no-network',
  '--no-console',
  '--no-ingest',
] as const;

const VIEWPORT_FLAG = /^--(video|mobile|tablet|hd|fhd|dynamic|viewport)/;
const VIEWPORT_MESSAGE = 'terrific-cli records no video and always uses the dynamic viewport';

export function tokenizeNewArgs(line: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch !== undefined && /\s/.test(ch)) {
      i += 1;
      continue;
    }
    const start = i;
    if (ch === '"' || ch === "'") {
      const close = line.indexOf(ch, i + 1);
      if (close < 0) {
        tokens.push({
          text: line.slice(i),
          start,
          end: line.length,
          quoted: true,
          open: true,
        });
        break;
      }
      tokens.push({
        text: line.slice(start, close + 1),
        start,
        end: close + 1,
        quoted: true,
        open: false,
      });
      i = close + 1;
      continue;
    }
    while (i < line.length) {
      const cur = line[i];
      if (cur === undefined || /\s/.test(cur)) break;
      i += 1;
    }
    tokens.push({ text: line.slice(start, i), start, end: i, quoted: false, open: false });
  }
  return tokens;
}

// Text after `/new `; the caller strips the command.
export function parseNewLine(line: string, context: NewContext): ParsedNew {
  return interpret(tokenizeNewArgs(line), context);
}

export function parseNewArgv(argv: string[], context: NewContext): ParsedNew {
  const tokens: RawToken[] = [];
  let offset = 0;
  for (const part of argv) {
    if (tokens.length > 0) offset += 1;
    tokens.push({
      text: part,
      start: offset,
      end: offset + part.length,
      quoted: /\s/.test(part),
      open: false,
    });
    offset += part.length;
  }
  return interpret(tokens, context);
}

function quotedValue(token: RawToken): string {
  if (!token.quoted) return token.text;
  const first = token.text[0];
  if (first !== '"' && first !== "'") return token.text;
  return token.open ? token.text.slice(1) : token.text.slice(1, -1);
}

function applyRecordFlags(record: SessionSetup['record'], flags: string[]): SessionSetup['record'] {
  const next = copyRecord(record);
  for (const flag of flags) {
    if (flag === '--no-actions') next.actions = false;
    if (flag === '--no-network') next.network = false;
    if (flag === '--no-console') next.console = false;
  }
  return next;
}

function interpret(raw: RawToken[], context: NewContext): ParsedNew {
  const tokens: Token[] = [];
  const nameParts: string[] = [];
  const nameTexts: string[] = [];
  let urlText: string | undefined;
  let profileText: string | undefined;
  let endpointText: string | undefined;
  const recordTexts: string[] = [];
  let noBrowser = false;
  let noIngest = false;
  let explicitEndpoint: string | undefined;

  for (const item of raw) {
    const token = classify(item, context, {
      hasUrl: urlText !== undefined,
      endpoint: explicitEndpoint,
    });
    tokens.push(token);
    if (token.kind === 'name') {
      nameParts.push(quotedValue(item));
      nameTexts.push(item.text);
      continue;
    }
    if (token.problem) continue;
    if (token.kind === 'url') urlText = token.text;
    else if (token.kind === 'profile') profileText = token.text;
    else if (token.kind === 'endpoint') {
      explicitEndpoint = token.text.slice(1).toLowerCase();
      endpointText = token.text;
    } else if (token.text === '--no-browser') noBrowser = true;
    else if (token.text === '--no-ingest') noIngest = true;
    else recordTexts.push(token.text);
  }

  const name = nameParts.join(' ').trim();
  const setup = copySetup(context.last);
  const sources: ParsedNew['sources'] = {};
  if (profileText !== undefined) {
    setup.profile = profileText.slice(1).toLowerCase();
    sources.profile = profileText;
  }
  if (recordTexts.length > 0) {
    setup.record = applyRecordFlags(context.last.record, recordTexts);
    sources.record = recordTexts.join(' ');
  }
  if (urlText !== undefined) {
    setup.url = normalizeUrl(urlText);
    sources.url = urlText;
  }

  if (noBrowser) {
    setup.target = 'none';
    sources.target = '--no-browser';
    for (const token of tokens) {
      const browserOnly =
        token.kind === 'url' ||
        token.kind === 'profile' ||
        (token.kind === 'flag' && recordTexts.includes(token.text));
      if (browserOnly && !token.problem)
        token.problem = problem('invalid', 'ignored with --no-browser');
    }
  } else if (urlText !== undefined) {
    setup.target = 'browser';
    sources.target = 'URL';
  } else if (profileText !== undefined || recordTexts.length > 0) {
    setup.target = 'browser';
    sources.target = 'browser options';
  } else if (name !== '') {
    setup.target = 'none';
    sources.target = 'name without URL';
  } else {
    setup.target = context.last.target;
    sources.target = 'last setup';
  }

  if (setup.target === 'none') {
    setup.url = '';
    setup.profile = context.last.profile;
    setup.record = copyRecord(context.last.record);
    delete sources.url;
    sources.profile = 'last setup';
    sources.record = 'last setup';
  } else {
    if (sources.url === undefined) {
      setup.url = context.last.url;
      sources.url = 'last setup';
    }
    if (sources.profile === undefined) sources.profile = 'last setup';
    if (sources.record === undefined) {
      setup.record = copyRecord(context.last.record);
      sources.record = 'last setup';
    }
  }

  if (noIngest) {
    setup.endpoint = null;
    sources.endpoint = '--no-ingest';
  } else if (explicitEndpoint !== undefined && endpointText !== undefined) {
    setup.endpoint = explicitEndpoint;
    sources.endpoint = endpointText;
  } else {
    const chosen = defaultEndpoint(context.last.endpoint, context.endpoints);
    if (setup.target === 'none' && chosen === null) {
      setup.endpoint = 'main';
      sources.endpoint = 'default without browser';
    } else if (chosen !== null) {
      setup.endpoint = chosen;
      sources.endpoint =
        chosen === context.last.endpoint ? 'last used' : 'most recent open endpoint';
    } else {
      setup.endpoint = null;
      sources.endpoint = 'last setup';
    }
  }

  if (name !== '') sources.name = nameTexts.join(' ');
  return {
    setup,
    name,
    tokens,
    sources,
    createsEndpoint:
      setup.endpoint !== null && !context.endpoints.some((item) => item.name === setup.endpoint),
  };
}

function problem(severity: TokenProblem['severity'], message: string): TokenProblem {
  return { severity, message };
}

function classify(
  item: RawToken,
  context: NewContext,
  state: { hasUrl: boolean; endpoint: string | undefined },
): Token {
  const token: Token = {
    text: item.text,
    start: item.start,
    end: item.end,
    kind: 'name',
    quoted: item.quoted,
  };
  const text = item.text;
  if (item.quoted) {
    if (item.open) token.problem = problem('incomplete', 'closing quote missing');
    return token;
  }
  if (text.startsWith('@')) {
    token.kind = 'profile';
    const query = text.slice(1).toLowerCase();
    const exact = context.profiles.find((profile) => profile.slug === query);
    if (query === '') token.problem = problem('incomplete', 'type a profile name');
    else if (exact?.blockedReason !== undefined) {
      token.problem = problem('invalid', exact.blockedReason);
    } else if (!exact && context.profiles.some((profile) => profile.slug.startsWith(query))) {
      token.problem = problem('incomplete', 'incomplete profile, Tab completes it');
    } else if (!exact) token.problem = problem('invalid', `no profile called "${query}"`);
    return token;
  }
  if (text.startsWith('#')) {
    token.kind = 'endpoint';
    const name = text.slice(1).toLowerCase();
    if (name === '') token.problem = problem('incomplete', 'type an endpoint name');
    else if (!isEndpointName(name)) {
      token.problem = problem('invalid', 'endpoint names use lowercase letters, digits and dashes');
    } else if (state.endpoint !== undefined) {
      token.problem = problem(
        'invalid',
        `one ingest endpoint per session, ${state.endpoint} is already set`,
      );
    }
    return token;
  }
  if (text.startsWith('--')) {
    token.kind = 'flag';
    if (NEW_FLAGS.some((flag) => flag === text)) return token;
    if (NEW_FLAGS.some((flag) => flag.startsWith(text))) {
      token.problem = problem('incomplete', 'incomplete flag, Tab completes it');
    } else if (VIEWPORT_FLAG.test(text)) token.problem = problem('invalid', VIEWPORT_MESSAGE);
    else token.problem = problem('invalid', `unknown flag ${text}`);
    return token;
  }
  if (isUrlWord(text)) {
    if (state.hasUrl) {
      token.problem = problem('invalid', 'only one URL per session, read as part of the name');
    } else token.kind = 'url';
    return token;
  }
  if (isUrlAttempt(text)) {
    token.problem = problem('invalid', 'not a valid URL, read as part of the name');
  }
  return token;
}

function quoteName(name: string): string {
  const special =
    /\s/.test(name) ||
    name.startsWith('@') ||
    name.startsWith('#') ||
    name.startsWith('--') ||
    isUrlWord(name) ||
    isUrlAttempt(name);
  return special ? `"${name}"` : name;
}

export function formatNewCommand(setup: SessionSetup, name: string): string {
  const parts: string[] = [];
  if (setup.target === 'browser' && setup.url !== '') parts.push(displayUrl(setup.url));
  if (name !== '') parts.push(quoteName(name));
  if (setup.target === 'browser') parts.push(`@${setup.profile}`);
  parts.push(setup.endpoint === null ? '--no-ingest' : `#${setup.endpoint}`);
  if (setup.target === 'none') {
    parts.push('--no-browser');
  } else {
    if (!setup.record.actions) parts.push('--no-actions');
    if (!setup.record.network) parts.push('--no-network');
    if (!setup.record.console) parts.push('--no-console');
  }
  return `/new ${parts.join(' ')}`;
}
