import { ago, clock, parseTime } from '../format.ts';
import { blank, type Line, line } from '../layout.ts';
import { keyHint, plural, type View } from './common.ts';
import { elapsed } from './header.ts';

/** Home keeps the focus on what is recording now; stopped and legacy sessions live in `/sessions`. */
export function homeLines(view: View): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const out: Line[] = [];

  if (state.endpoints.length > 0) {
    const parts = state.endpoints.map((ep) => {
      if (ep.state !== 'open') return p(`○ ${ep.name} closed`, 'fg3');
      const last = parseTime(ep.lastEventAt);
      const when = last === null ? 'nothing yet' : ago(state.now - last);
      return `${p('●', 'ingest')} ${p(ep.name, 'fg1')} ${p(`${plural(ep.eventCount, 'event')} · ${when}`, 'fg3')}`;
    });
    out.push(
      line(
        ` ${p('Ingest', { tone: 'fg1', bold: true })}   ${parts.join('    ')}`,
        `${keyHint(theme, '/ingest', 'manage')}  `,
      ),
      blank(),
    );
  }

  out.push(
    line(
      ` ${p('Recording', { tone: 'fg1', bold: true })}  ${p('in this project', 'fg3')}`,
      `${keyHint(theme, '/sessions', 'all')}  `,
    ),
    blank(),
  );
  const attached = state.live?.session.status === 'recording' ? state.live.session : null;
  const recording = state.sessions.filter((item) => item.status === 'recording');
  const rows: Row[] = recording.map((item) => ({
    id: item.id,
    name: item.name,
    startedAt: item.startedAt,
    total: item.total,
    bugs: item.bugs,
    errors: item.errors,
  }));
  // A session started from here can show up before the list refreshes.
  if (attached !== null && !rows.some((row) => row.id === attached.id)) {
    rows.unshift({
      id: attached.id,
      name: attached.name,
      startedAt: attached.startedAt,
      total: null,
      bugs: 0,
      errors: 0,
    });
  }
  if (rows.length === 0) {
    out.push(line(`   ${p('Nothing recording.', 'fg3')} ${keyHint(theme, '/new', 'starts one')}`));
  }
  for (const row of rows) {
    const name =
      row.name === null ? p('untitled', 'fg3') : p(row.name, { tone: 'fg1', bold: true });
    const open = row.id === attached?.id ? `  ${keyHint(theme, '/attach', 'open it')}` : '';
    const right = [
      p(clock(elapsed(state, row.startedAt)).padStart(8), 'fg2'),
      ' ',
      p(row.total === null ? ''.padEnd(11) : `${String(row.total).padStart(4)} events`, 'fg2'),
      ' ',
      p((row.bugs > 0 ? plural(row.bugs, 'bug') : '').padEnd(7), row.bugs > 0 ? 'bug' : 'fg3'),
      p(
        (row.errors > 0 ? plural(row.errors, 'error') : '').padEnd(9),
        row.errors > 0 ? 'failure' : 'fg3',
      ),
    ].join(' ');
    out.push(
      line(
        `   ${p('●', { tone: 'err', bold: true })} ${name}  ${p(row.id, 'fg3')}${open}`,
        `${right} `,
      ),
    );
  }
  return out;
}

interface Row {
  id: string;
  name: string | null;
  startedAt: string;
  total: number | null;
  bugs: number;
  errors: number;
}
