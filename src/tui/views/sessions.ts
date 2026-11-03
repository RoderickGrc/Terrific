import type { SessionListItem } from '../../core/api.ts';
import { formatDuration, formatOffset } from '../../core/format.ts';
import { dateTime, dayLabel, parseTime } from '../format.ts';
import { blank, type Line, line, padEndVisible, renderLine } from '../layout.ts';
import type { SessionsOverlay, TuiState } from '../state.ts';
import { inputText, placeholderText, plural, type View } from './common.ts';
import { projectName } from './header.ts';
import { markRail } from './summary.ts';

export type SessionRow = { item: SessionListItem; gutter: string; pinned: boolean };

const WIDE = 100;
const PREVIEW_WIDTH = 44;
const GUTTER = 10;
const SHOWN_MARKS = 3;

export function sessionRows(state: TuiState, query: string): SessionRow[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const all = [...state.sessions, ...(state.legacy ?? [])].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return q === '' || `${item.name ?? ''} ${item.id}`.toLowerCase().includes(q);
  });
  const pinnedIds = state.settings.pinned;
  const pinned = pinnedIds
    .map((id) => all.find((item) => item.id === id))
    .filter((item): item is SessionListItem => item !== undefined);
  const rest = all
    .filter((item) => !pinnedIds.includes(item.id))
    .sort((a, b) => (parseTime(b.startedAt) ?? 0) - (parseTime(a.startedAt) ?? 0));
  const rows: SessionRow[] = pinned.map((item, i) => ({
    item,
    gutter: i === 0 ? 'Pinned' : '',
    pinned: true,
  }));
  let last = '';
  for (const item of rest) {
    const label = dayLabel(parseTime(item.startedAt) ?? 0, state.now);
    rows.push({ item, gutter: label === last ? '' : label, pinned: false });
    last = label;
  }
  return rows;
}

function preview(view: View, item: SessionListItem): string[] {
  const { theme } = view;
  const p = theme.paint;
  const bar = (text = ''): string => `${p('│', 'fg3')} ${text}`;
  const started = parseTime(item.startedAt) ?? 0;
  const out = [
    bar(p(item.name ?? 'untitled', { tone: 'fg1', bold: true })),
    bar(p(item.id, 'fg3')),
    bar(),
    bar(`${p(dateTime(started), 'fg1')}  ${p(formatDuration(item.durationMs), 'fg2')}`),
    bar(`${p(String(item.total), { tone: 'fg1', bold: true })} ${p('events', 'fg2')}`),
    bar(
      [
        item.bugs > 0 ? p(plural(item.bugs, 'bug'), 'bug') : '',
        item.flags > 0 ? p(plural(item.flags, 'flag'), 'flag') : '',
        item.errors > 0 ? p(plural(item.errors, 'error'), 'failure') : p('no errors', 'fg2'),
      ]
        .filter((part) => part !== '')
        .join(p(' · ', 'fg3')),
    ),
    bar(),
  ];
  for (const mark of item.marks.slice(0, SHOWN_MARKS)) {
    const bug = mark.kind === 'bug';
    out.push(
      bar(
        `${p(formatOffset(mark.t).slice(0, 5), 'fg3')} ${p(bug ? '●' : '◆', bug ? 'bug' : 'flag')} ${p(mark.kind, 'fg2')}`,
      ),
    );
  }
  if (item.marks.length > SHOWN_MARKS)
    out.push(bar(p(`+${item.marks.length - SHOWN_MARKS} more`, 'fg3')));
  if (item.marks.length === 0) out.push(bar(p('nothing reported', 'fg3')));
  out.push(
    bar(),
    bar(
      p(
        item.legacy
          ? 'legacy store, read only'
          : item.status === 'recording'
            ? 'recording now'
            : '',
        'fg3',
      ),
    ),
  );
  return out;
}

export function sessionsLines(view: View, overlay: SessionsOverlay): Line[] {
  const { theme, state, width, height } = view;
  const p = theme.paint;
  const rows = sessionRows(state, overlay.query);
  overlay.index = Math.min(overlay.index, Math.max(0, rows.length - 1));
  const total = state.sessions.length + (state.legacy?.length ?? 0);
  const pinnedCount = state.settings.pinned.length;
  const out: Line[] = [
    blank(),
    line(
      `   ${p('Sessions', { tone: 'fg1', bold: true })}  ${p(projectName(state), 'fg3')}`,
      `${p(`${plural(total, 'session')}${pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}${state.legacy === null ? ' · loading legacy' : ''}`, 'fg3')}   `,
    ),
    overlay.renaming !== null
      ? line(
          `   ${p('rename ›', { tone: 'warn', bold: true })} ${inputText(theme, state.input, width - 16)}`,
        )
      : line(
          `   ${p('filter ›', 'fg2')} ${state.input.value === '' ? placeholderText(theme, ' name or id') : inputText(theme, state.input, width - 16)}`,
        ),
    blank(),
  ];
  const wide = width >= WIDE;
  const listWidth = wide ? width - PREVIEW_WIDTH : width;
  const room = Math.max(1, height - out.length);
  const start = Math.max(0, Math.min(overlay.index - Math.floor(room / 2), rows.length - room));
  const list: Line[] = rows.slice(start, start + room).map((row, offset) => {
    const index = start + offset;
    const on = index === overlay.index;
    const item = row.item;
    const deleting = overlay.confirmDelete === item.id;
    const gutter = p(row.gutter.padEnd(GUTTER), row.pinned ? 'accent' : 'fg3');
    const name =
      overlay.renaming === item.id
        ? inputText(theme, state.input, listWidth - 40)
        : p(item.name ?? 'untitled', {
            tone: deleting ? 'bug' : item.name === null ? 'fg3' : 'fg1',
            bold: on || deleting,
          });
    const right = wide
      ? `${markRail(theme, item.durationMs, 18, item.marks)}  `
      : `${p(formatDuration(item.durationMs).padStart(7), 'fg3')} ${p(String(item.total).padStart(4), 'fg3')}  `;
    return line(
      `   ${gutter}${on ? p('▌', { tone: 'accent', bold: true }) : ' '} ${name}`,
      right,
      on ? 'prompt' : undefined,
    );
  });
  if (rows.length === 0) list.push(line(`   ${p('No sessions match', 'fg3')}`));
  if (!wide) return [...out, ...list];

  const selected = rows[overlay.index]?.item;
  const pane = selected === undefined ? [] : preview(view, selected);
  const count = Math.max(list.length, pane.length);
  for (let i = 0; i < count && i < room; i += 1) {
    const left = renderLine(theme, list[i] ?? blank(), listWidth);
    out.push(line(`${left}${padEndVisible(pane[i] ?? '', PREVIEW_WIDTH)}`));
  }
  return out;
}
