import { formatDuration } from '../../core/format.ts';
import { ago, clock, parseTime, shortDate } from '../format.ts';
import { blank, type Line, line } from '../layout.ts';
import { keyHint, plural, type View } from './common.ts';
import { elapsed } from './header.ts';

const RECENT = 7;

export function homeLines(view: View): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const out: Line[] = [];

  const live = state.live;
  if (live !== null && live.session.status === 'recording') {
    const s = live.session;
    out.push(
      line(
        `  ${p('●', { tone: 'err', bold: true })} ${p('Recording in the background', 'fg1')}  ${p(s.name ?? 'untitled', { tone: 'fg1', bold: true })}  ${p(clock(elapsed(state, s.startedAt)), 'fg2')}`,
        `${keyHint(theme, '/attach', 'open it')}  `,
      ),
      blank(),
    );
  }

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
      ` ${p('Recent sessions', { tone: 'fg1', bold: true })}  ${p('in this project', 'fg3')}`,
      `${keyHint(theme, '/sessions', 'all')}  `,
    ),
    blank(),
  );
  const recent = state.sessions.slice(0, RECENT);
  if (recent.length === 0) {
    out.push(line(`   ${p('No sessions yet.', 'fg3')} ${keyHint(theme, '/new', 'starts one')}`));
  }
  for (const item of recent) {
    const started = parseTime(item.startedAt) ?? 0;
    const name = item.name === null ? p('untitled', 'fg3') : p(item.name, 'fg1');
    const live = item.status === 'recording' ? `  ${p('● recording', 'err')}` : '';
    const right = [
      p(shortDate(started).padEnd(7), 'fg2'),
      p(formatDuration(item.durationMs).padStart(7), 'fg3'),
      ' ',
      p(`${String(item.total).padStart(4)} events`, 'fg2'),
      ' ',
      p((item.bugs > 0 ? plural(item.bugs, 'bug') : '').padEnd(7), item.bugs > 0 ? 'bug' : 'fg3'),
      p(
        (item.errors > 0 ? plural(item.errors, 'error') : '').padEnd(9),
        item.errors > 0 ? 'failure' : 'fg3',
      ),
    ].join(' ');
    out.push(line(`   ${name}  ${p(item.id, 'fg3')}${live}`, `${right} `));
  }
  return out;
}
