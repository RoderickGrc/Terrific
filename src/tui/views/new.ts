import type { ParsedNew, SetupField, TokenKind } from '../../core/new-command.ts';
import type { Suggestion } from '../../core/new-suggestions.ts';
import { displayUrl, isUrlWord, type SessionSetup } from '../../core/setup.ts';
import { blank, type Line, line } from '../layout.ts';
import { type NewOverlay, newFields, RECORD_KEYS, type TuiState } from '../state.ts';
import type { Tone } from '../theme.ts';
import { inputText, sep, type View } from './common.ts';
import { profileLabel, projectName } from './header.ts';

export const NEW_PREFIX = '/new ';

const TOKEN_TONE: Record<TokenKind, Tone> = {
  url: 'accent',
  name: 'fg1',
  profile: 'info',
  endpoint: 'ingest',
  flag: 'fg2',
};

export type Assist = {
  parsed: ParsedNew;
  /** Caret inside the text after `/new `. */
  caret: number;
  suggestions: Suggestion[];
};

function endpointState(state: TuiState, name: string): string {
  const found = state.endpoints.find((ep) => ep.name === name);
  if (found === undefined) return 'new';
  return found.state === 'open' ? 'open' : 'reopens';
}

function profileDetail(state: TuiState, slug: string): string {
  return state.profiles.find((profile) => profile.slug === slug)?.detail ?? '';
}

export function assistLines(view: View, assist: Assist): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const raw = state.input.value.slice(NEW_PREFIX.length);
  const here = assist.parsed.tokens.find((t) => assist.caret >= t.start && assist.caret <= t.end);

  let echo = p('/new', { tone: 'accent', bold: true });
  let pos = 0;
  echo += ' ';
  for (const token of assist.parsed.tokens) {
    echo += raw.slice(pos, token.start);
    const problem = token.problem;
    const tone: Tone =
      problem === undefined
        ? TOKEN_TONE[token.kind]
        : problem.severity === 'invalid'
          ? 'err'
          : 'warn';
    const text = p(raw.slice(token.start, token.end), {
      tone,
      bold: token.kind === 'name',
      underline: problem !== undefined,
    });
    echo += token === here ? theme.highlight(text, 'editor') : text;
    pos = token.end;
  }
  echo += raw.slice(pos);

  const out: Line[] = [line(` ${echo}`, '', 'prompt'), blank('prompt')];
  const { setup, sources } = assist.parsed;
  const row = (labelText: string, value: string, field: SetupField): Line =>
    line(
      `   ${p(labelText.padEnd(10), 'fg2')}${value}`,
      `${sources[field] === undefined ? p('last setup', 'fg3') : p(sources[field], 'fg2')}  `,
      'prompt',
    );
  const name = assist.parsed.name;
  out.push(
    row('Target', p(setup.target === 'browser' ? 'Browser' : 'No browser', 'fg1'), 'target'),
  );
  if (setup.target === 'browser') {
    out.push(
      row(
        'URL',
        setup.url === '' ? p('empty tab', 'fg3') : p(displayUrl(setup.url), 'accent'),
        'url',
      ),
      row('Name', name === '' ? p('untitled', 'fg3') : p(name, 'fg1'), 'name'),
      row(
        'Profile',
        `${p(profileLabel(state, setup.profile), 'fg1')}  ${p(profileDetail(state, setup.profile), 'fg2')}`,
        'profile',
      ),
      row(
        'Record',
        RECORD_KEYS.filter((k) => setup.record[k])
          .map((k) => p(k, 'fg1'))
          .join(' ') || p('nothing', 'fg3'),
        'record',
      ),
    );
  } else {
    out.push(row('Name', name === '' ? p('untitled', 'fg3') : p(name, 'fg1'), 'name'));
  }
  out.push(
    row(
      'Ingest',
      setup.endpoint === null
        ? p('none', 'fg3')
        : `${p(setup.endpoint, 'ingest')} ${p(endpointState(state, setup.endpoint), 'fg3')}`,
      'endpoint',
    ),
  );

  const problems = assist.parsed.tokens.filter((t) => t.problem !== undefined);
  if (problems.length > 0) {
    out.push(blank('prompt'));
    for (const token of problems) {
      const invalid = token.problem?.severity === 'invalid';
      out.push(
        line(
          `   ${p(invalid ? '✕' : '!', { tone: invalid ? 'err' : 'warn', bold: true })} ${p(token.text, TOKEN_TONE[token.kind])}  ${p(token.problem?.message ?? '', invalid ? 'err' : 'warn')}`,
          '',
          'prompt',
        ),
      );
    }
  }

  if (assist.suggestions.length > 0) {
    out.push(
      blank('prompt'),
      line(`   ${p(here === undefined ? 'Tab inserts' : 'Tab completes', 'fg3')}`, '', 'prompt'),
    );
    assist.suggestions.forEach((suggestion, index) => {
      const on = index === state.suggestionIndex;
      const tone: Tone = suggestion.disabled === true ? 'fg3' : on ? 'accent' : 'fg1';
      out.push(
        line(
          `${on ? p(' › ', { tone: 'accent', bold: true }) : '   '}${p(suggestion.label.padEnd(26), { tone, bold: on })}${p(suggestion.detail, suggestion.disabled === true ? 'fg3' : 'fg2')}`,
          '',
          on ? 'pick' : 'prompt',
        ),
      );
    });
  }
  out.push(
    blank('prompt'),
    line(
      `   ${p('Enter', { tone: 'ok', bold: true })} ${p('review and confirm', 'fg2')}`,
      '',
      'prompt',
    ),
  );
  return out;
}

export function endpointChoices(state: TuiState, setup: SessionSetup): string[] {
  const names = ['none', ...state.endpoints.map((ep) => ep.name)];
  if (setup.endpoint !== null && !names.includes(setup.endpoint)) names.push(setup.endpoint);
  return names;
}

function startsWhat(state: TuiState, overlay: NewOverlay): string {
  const s = overlay.setup;
  const what =
    s.target === 'browser'
      ? `${s.url === '' ? 'opens an empty tab' : `opens ${displayUrl(s.url)}`} with ${profileLabel(state, s.profile)}`
      : 'records without a browser';
  return s.endpoint === null ? what : `${what}, linked to ingest ${s.endpoint}`;
}

export function confirmLines(view: View, overlay: NewOverlay): Line[] {
  const { theme, state, width } = view;
  const p = theme.paint;
  const fields = newFields(overlay.setup);
  const current = fields[Math.min(overlay.field, fields.length - 1)];
  const out: Line[] = [
    blank(),
    line(
      `   ${p('Confirm new session', { tone: 'fg1', bold: true })}  ${p(projectName(state), 'fg3')}`,
    ),
    blank(),
  ];
  const arrows = (on: boolean, text: string): string =>
    on ? `${p('‹ ', 'fg3')}${text}${p(' ›', 'fg3')}` : text;
  const room = Math.max(10, width - 50);
  const s = overlay.setup;
  for (const field of fields) {
    const on = field === current;
    let value = '';
    let aside = '';
    if (field === 'target') {
      value = (['browser', 'none'] as const)
        .map((target) => {
          const labelText = target === 'browser' ? 'Browser' : 'No browser';
          return s.target === target
            ? p(labelText, { tone: on ? 'accent' : 'fg1', bold: true })
            : p(labelText, 'fg3');
        })
        .join(sep(theme));
    }
    if (field === 'url') {
      value = on
        ? inputText(theme, state.input, room)
        : s.url === ''
          ? p('empty tab', 'fg3')
          : p(s.url, 'fg1');
      const text = on ? state.input.value.trim() : s.url;
      aside =
        text !== '' && !isUrlWord(text) ? p('not a URL yet', 'failure') : p('optional', 'fg3');
    }
    if (field === 'name') {
      value = on
        ? inputText(theme, state.input, room)
        : overlay.name === ''
          ? p('untitled', 'fg3')
          : p(overlay.name, 'fg1');
      aside = p('optional', 'fg3');
    }
    if (field === 'profile') {
      value = arrows(
        on,
        `${p(profileLabel(state, s.profile), 'fg1')}  ${p(profileDetail(state, s.profile), 'fg2')}`,
      );
      if (on) aside = p('Space all profiles', 'fg3');
    }
    if (field === 'record') {
      value = RECORD_KEYS.map((key, index) => {
        const box = s.record[key] ? '[x]' : '[ ]';
        const styled =
          on && index === overlay.recordIndex
            ? theme.caret(box)
            : p(box, s.record[key] ? 'accent' : 'fg3');
        return `${styled} ${p(key, s.record[key] ? 'fg1' : 'fg3')}`;
      }).join('   ');
    }
    if (field === 'endpoint') {
      const picked = s.endpoint ?? 'none';
      value = arrows(
        on,
        endpointChoices(state, s)
          .map((name) => {
            const stateText = name === 'none' ? '' : ` ${endpointState(state, name)}`;
            if (name !== picked) return p(name, 'fg3');
            const tone: Tone = name === 'none' ? (on ? 'accent' : 'fg1') : 'ingest';
            return `${p(name, { tone, bold: true })}${p(stateText === ' open' ? '' : stateText, 'fg3')}`;
          })
          .join(sep(theme)),
      );
      aside = p('one per session, stays open after it', 'fg3');
    }
    const labelText = {
      target: 'Target',
      url: 'URL',
      name: 'Name',
      profile: 'Profile',
      record: 'Record',
      endpoint: 'Ingest',
    }[field];
    out.push(
      line(
        `${on ? p(' ▌ ', { tone: 'accent', bold: true }) : '   '}${p(labelText.padEnd(10), on ? { tone: 'fg1', bold: true } : 'fg2')}${value}`,
        aside === '' ? '' : `${aside}   `,
        on ? 'prompt' : undefined,
      ),
    );
  }
  out.push(
    blank(),
    line(
      `   ${p('Enter', { tone: 'ok', bold: true })} ${p(`starts now: ${startsWhat(state, overlay)}`, 'fg2')}`,
    ),
  );
  return out;
}
