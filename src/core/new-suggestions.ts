import type { NewContext, ParsedNew, Token } from './new-command.ts';
import { NEW_FLAGS } from './new-command.ts';
import type { EndpointOption, ProfileOption } from './setup.ts';
import { displayUrl, isEndpointName } from './setup.ts';

export type Suggestion = {
  insert: string;
  label: string;
  detail: string;
  disabled?: boolean;
};

export type SuggestContext = NewContext & { recentUrls: string[] };

const FLAG_DETAIL: Record<(typeof NEW_FLAGS)[number], string> = {
  '--no-browser': 'record without a browser',
  '--no-actions': 'do not record actions',
  '--no-network': 'do not record network',
  '--no-console': 'do not record console',
  '--no-ingest': 'no ingest endpoint',
};

function tokenAtCaret(tokens: Token[], caret: number): Token | undefined {
  return tokens.find((token) => caret >= token.start && caret <= token.end);
}

function uniqueDisplayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const display = displayUrl(url);
    const key = display.toLowerCase();
    if (display === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}

function urlSuggestions(query: string, recent: string[], limit: number): Suggestion[] {
  const needle = displayUrl(query).toLowerCase();
  const out: Suggestion[] = [];
  for (const url of recent) {
    if (out.length >= limit) break;
    const lower = url.toLowerCase();
    if (!lower.startsWith(needle) || lower === needle) continue;
    out.push({ insert: url, label: url, detail: 'recent URL' });
  }
  return out;
}

function profileSuggestions(query: string, profiles: ProfileOption[]): Suggestion[] {
  const q = query.toLowerCase();
  const out: Suggestion[] = [];
  for (const profile of profiles) {
    if (out.length >= 6) break;
    if (!profile.slug.startsWith(q) && !profile.label.toLowerCase().includes(q)) continue;
    const suggestion: Suggestion = {
      insert: `@${profile.slug}`,
      label: `@${profile.slug}`,
      detail: `${profile.label} · ${profile.detail}`,
    };
    if (profile.blockedReason !== undefined) suggestion.disabled = true;
    out.push(suggestion);
  }
  return out;
}

function endpointSuggestions(query: string, endpoints: EndpointOption[]): Suggestion[] {
  const q = query.toLowerCase();
  const out: Suggestion[] = [];
  for (const endpoint of endpoints) {
    if (!endpoint.name.startsWith(q)) continue;
    out.push({
      insert: `#${endpoint.name}`,
      label: `#${endpoint.name}`,
      detail:
        endpoint.state === 'open'
          ? `open · ${endpoint.eventCount} events`
          : 'closed, reopens on start',
    });
  }
  if (q !== '' && isEndpointName(q) && !endpoints.some((item) => item.name === q)) {
    out.push({ insert: `#${q}`, label: `#${q}`, detail: 'create this endpoint' });
  }
  return out.slice(0, 6);
}

function flagSuggestions(query: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const flag of NEW_FLAGS) {
    if (!flag.startsWith(query) || flag === query) continue;
    out.push({ insert: flag, label: flag, detail: FLAG_DETAIL[flag] });
  }
  return out;
}

export function suggestNew(
  parsed: ParsedNew,
  caret: number,
  context: SuggestContext,
): Suggestion[] {
  const recent = uniqueDisplayUrls(context.recentUrls);
  const token = tokenAtCaret(parsed.tokens, caret);
  if (token === undefined) {
    const out: Suggestion[] = [];
    if (!parsed.tokens.some((item) => item.kind === 'url')) {
      for (const url of recent.slice(0, 3)) {
        out.push({ insert: url, label: url, detail: 'recent URL' });
      }
    }
    out.push(
      { insert: '@', label: '@profile', detail: 'browser profile' },
      { insert: '#', label: '#endpoint', detail: 'the ingest endpoint for this session' },
      { insert: '--', label: '--flag', detail: 'no browser, what to record' },
    );
    return out;
  }
  if (token.quoted) return [];
  const text = token.text;
  if (text.startsWith('@')) return profileSuggestions(text.slice(1), context.profiles);
  if (text.startsWith('#')) return endpointSuggestions(text.slice(1), context.endpoints);
  if (text.startsWith('--')) return flagSuggestions(text);
  const otherUrl = parsed.tokens.some((item) => item !== token && item.kind === 'url');
  if (token.kind === 'url' || (!otherUrl && text.length >= 2)) {
    return urlSuggestions(text, recent, 4);
  }
  return [];
}

export function applySuggestion(
  line: string,
  caret: number,
  parsed: ParsedNew,
  suggestion: Suggestion,
): { line: string; caret: number } {
  const token = tokenAtCaret(parsed.tokens, caret);
  const start = token?.start ?? caret;
  const end = token?.end ?? caret;
  const glue = /[@#-]$/.test(suggestion.insert) ? '' : ' ';
  const next = line.slice(0, start) + suggestion.insert + glue + line.slice(end).replace(/^ /, '');
  return { line: next, caret: start + suggestion.insert.length + glue.length };
}
