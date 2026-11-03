import { formatDuration } from '../../core/format.ts';
import type { CommandSpec } from '../commands.ts';
import { blank, type Line, line } from '../layout.ts';
import type { LiveState, PickerItem, PickerOverlay, TuiState } from '../state.ts';
import { RECORD_KEYS } from '../state.ts';
import { plural, sep, type View } from './common.ts';
import { elapsed, profileLabel } from './header.ts';

export function paletteLines(view: View, matches: CommandSpec[]): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const query = state.input.value.slice(1).toLowerCase();
  const out: Line[] = [blank('prompt')];
  matches.forEach((command, index) => {
    const on = index === state.paletteIndex;
    const via =
      query !== '' && !command.name.startsWith(query)
        ? command.aliases?.find((alias) => alias.startsWith(query))
        : undefined;
    const keyTone = command.name === 'bug' ? 'bug' : command.name === 'flag' ? 'flag' : 'fg3';
    const right =
      via !== undefined
        ? `${p(`alias /${via}`, 'fg3')}  `
        : command.key !== undefined
          ? `${p(command.key, keyTone)}  `
          : '';
    const args = command.args === undefined ? '' : `  ${p(command.args, 'fg3')}`;
    out.push(
      line(
        `${on ? p(' › ', { tone: 'accent', bold: true }) : '   '}${p(`/${command.name}`.padEnd(13), on ? { tone: 'accent', bold: true } : 'fg1')}${p(command.description, 'fg2')}${args}`,
        right,
        on ? 'pick' : 'prompt',
      ),
    );
  });
  out.push(blank('prompt'));
  return out;
}

export function stopLines(view: View, live: LiveState): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const counts = live.log.counts();
  const parts = [
    p(formatDuration(elapsed(state, live.session.startedAt)), 'fg1'),
    p(plural(counts.total, 'event'), 'fg1'),
    p(plural(counts.bugs, 'bug'), counts.bugs > 0 ? { tone: 'bug', bold: true } : 'fg3'),
    p(plural(counts.flags, 'flag'), counts.flags > 0 ? { tone: 'flag', bold: true } : 'fg3'),
    p(
      counts.errors > 0 ? plural(counts.errors, 'error') : 'no errors',
      counts.errors > 0 ? { tone: 'failure', bold: true } : 'fg3',
    ),
  ];
  const out: Line[] = [
    blank('prompt'),
    line(`   ${p('Stop recording?', { tone: 'fg1', bold: true })}`, '', 'prompt'),
    blank('prompt'),
    line(`   ${parts.join(sep(theme))}`, '', 'prompt'),
  ];
  const endpoint = live.session.endpoint;
  if (endpoint !== null) {
    out.push(
      line(
        `   ${p('Ingest', 'fg2')} ${p(endpoint.name, 'ingest')} ${p('stays open', 'fg3')}`,
        '',
        'prompt',
      ),
    );
  }
  out.push(
    blank('prompt'),
    line(
      `   ${p('Enter', { tone: 'ok', bold: true })} ${p('stop and save with the name below', 'fg2')}     ${p('Esc', 'fg2')} ${p('keep recording', 'fg3')}`,
      '',
      'prompt',
    ),
    blank('prompt'),
  );
  return out;
}

export function filteredItems(overlay: PickerOverlay, query: string): PickerItem[] {
  const q = query.trim().toLowerCase();
  if (!overlay.filter || q === '') return overlay.items;
  return overlay.items.filter(
    (item) =>
      item.heading !== true && `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(q),
  );
}

export function itemLines(view: View, title: string, items: PickerItem[], index: number): Line[] {
  const { theme, height } = view;
  const p = theme.paint;
  const out: Line[] = [
    line(` ${p(title, { tone: 'fg1', bold: true })}`, '', 'prompt'),
    blank('prompt'),
  ];
  // Title, blank and a closing blank take three rows of the panel.
  const room = Math.max(3, height - 3);
  const start = Math.max(0, Math.min(index - Math.floor(room / 2), items.length - room));
  items.slice(start, start + room).forEach((item, offset) => {
    const i = start + offset;
    if (item.heading === true) {
      if (i > 0) out.push(blank('prompt'));
      out.push(line(`   ${p(item.label, { tone: 'fg2', bold: true })}`, '', 'prompt'));
      return;
    }
    const on = i === index;
    const mark =
      item.checked !== undefined
        ? item.checked
          ? p('[x] ', 'accent')
          : p('[ ] ', 'fg3')
        : item.current === true
          ? p('✓ ', 'ok')
          : '  ';
    const labelTone = item.disabled !== undefined ? 'fg3' : on ? 'accent' : (item.tone ?? 'fg1');
    out.push(
      line(
        `${on ? p(' › ', { tone: 'accent', bold: true }) : '   '}${mark}${p(item.label.padEnd(18), { tone: labelTone, bold: on })}${p(item.detail ?? '', item.disabled !== undefined ? 'fg3' : 'fg2')}`,
        item.disabled === undefined ? '' : `${p(item.disabled, 'fg3')}  `,
        on ? 'pick' : 'prompt',
      ),
    );
  });
  if (items.length === 0) out.push(line(`   ${p('No matches', 'fg3')}`, '', 'prompt'));
  out.push(blank('prompt'));
  return out;
}

export const VISIBILITY_LABELS = {
  action: { label: 'actions', tone: 'act' },
  network: { label: 'network', tone: 'net' },
  console: { label: 'console', tone: 'log' },
  ingest: { label: 'ingest', tone: 'ingest' },
} as const;

/** Settings rows; ids are read by the app: `profile`, `record:<key>`, `show:<key>`. */
export function settingsItems(state: TuiState): PickerItem[] {
  const items: PickerItem[] = [];
  const setup = state.settings.lastSetup;
  if (state.screen !== 'live') {
    const profile = state.profiles.find((item) => item.slug === setup.profile);
    items.push(
      { id: 'head:new', label: 'Defaults for /new', heading: true },
      {
        id: 'profile',
        label: 'Profile',
        detail: `${profileLabel(state, setup.profile)}${profile === undefined ? '' : ` · ${profile.detail}`}`,
      },
    );
    for (const key of RECORD_KEYS) {
      items.push({ id: `record:${key}`, label: `Record ${key}`, checked: setup.record[key] });
    }
  }
  items.push({ id: 'head:show', label: 'Live log shows (kept for next time)', heading: true });
  for (const key of Object.keys(VISIBILITY_LABELS) as (keyof typeof VISIBILITY_LABELS)[]) {
    const { label, tone } = VISIBILITY_LABELS[key];
    items.push({ id: `show:${key}`, label, tone, checked: state.settings.visibility[key] });
  }
  return items;
}

const HELP_KEYS: [string, string][] = [
  ['/new …', 'url, name words, "quoted name", @profile, one #endpoint, --flags; Enter reviews'],
  ['Tab', 'complete the part under the cursor while typing /new'],
  ['Enter', 'run a command; while recording, save the text as a note'],
  ['Ctrl+Enter', 'mark a bug, with or without text'],
  ['Ctrl+Shift+Enter', 'flag the moment, with or without text'],
  ['F5 / F6', 'screenshot / page snapshot (browser sessions)'],
  ['↑ ↓', 'inspect events when the input is empty; Enter expands one'],
  ['PgUp PgDn End', 'scroll the log; End follows new events again'],
  ['Esc', 'back out one level'],
  ['Ctrl+C twice', 'quit; a recording session keeps running in the background'],
];

/** Keys only: typing `/` lists every command that works on the current screen. */
export function helpLines(view: View): Line[] {
  const { theme } = view;
  const p = theme.paint;
  const out: Line[] = [blank(), line(`   ${p('Keys', { tone: 'fg1', bold: true })}`), blank()];
  for (const [key, detail] of HELP_KEYS) {
    out.push(line(`   ${p(key.padEnd(18), 'accent')}${p(detail, 'fg2')}`));
  }
  out.push(
    blank(),
    line(
      `   ${p('/', 'accent')} ${p('lists the commands that work here, with what each one does', 'fg2')}`,
    ),
  );
  return out;
}
