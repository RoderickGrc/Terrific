import { basename } from 'node:path';
import { formatDuration } from '../../core/format.ts';
import { displayUrl } from '../../core/setup.ts';
import { clock, parseTime } from '../format.ts';
import { blank, type Line, line } from '../layout.ts';
import type { TuiState } from '../state.ts';
import type { Theme } from '../theme.ts';

export function projectName(state: TuiState): string {
  return basename(state.project.cwd) || state.project.cwd;
}

export function profileLabel(state: TuiState, slug: string): string {
  return state.profiles.find((profile) => profile.slug === slug)?.label ?? slug;
}

export function elapsed(state: TuiState, startedAt: string): number {
  const start = parseTime(startedAt);
  return start === null ? 0 : state.now - start;
}

export function headerLines(theme: Theme, state: TuiState): Line[] {
  const p = theme.paint;
  const title = ` ${p('Terrific', { tone: 'info', bold: true })}  ${p(projectName(state), 'fg2')}`;
  const live = state.live;

  if (state.screen === 'live' && live !== null) {
    const s = live.session;
    const recording = s.status === 'recording';
    const status = recording
      ? p('● REC', { tone: 'err', bold: true })
      : p('STOPPED', { tone: 'ok', bold: true });
    const where =
      s.setup.target === 'browser'
        ? `${p('Profile', 'fg2')} ${p(profileLabel(state, s.setup.profile), 'fg1')}`
        : p('No browser', 'fg1');
    const ingest =
      s.endpoint === null ? '' : `  ${p('Ingest', 'fg2')} ${p(s.endpoint.name, 'ingest')}`;
    const meta = ` ${p('Session', 'fg2')} ${p(s.name ?? 'untitled', { tone: 'fg1', bold: true })}  ${where}${ingest}`;
    let third: string;
    if (s.setup.target === 'browser') {
      const url = live.log.currentUrl() ?? s.setup.url;
      third = ` ${p('URL', 'fg2')}  ${p(url === '' ? 'empty tab' : url, 'accent')}`;
    } else if (s.endpoint !== null) {
      third = ` ${p('POST', 'fg2')} ${p(s.endpoint.url, 'accent')}`;
    } else {
      third = ` ${p('No ingest endpoint. Notes, bugs and flags only', 'fg3')}`;
    }
    return [
      line(title, p(`${s.id} • ${clock(elapsed(state, s.startedAt))} `, 'fg2')),
      line(meta, `${status}  `),
      line(third),
      blank(),
    ];
  }

  const summary = state.summary;
  if (state.screen === 'summary' && summary !== null) {
    const d = summary.detail;
    const start = parseTime(d.startedAt);
    const end = parseTime(d.stoppedAt);
    const duration = start !== null && end !== null ? end - start : d.stats.durationMs;
    const status = d.legacy
      ? p('COMPLETED', { tone: 'fg2', bold: true })
      : d.status === 'recording'
        ? p('● REC', { tone: 'err', bold: true })
        : p('STOPPED', { tone: 'ok', bold: true });
    const third =
      d.setup.target === 'browser'
        ? ` ${p('URL', 'fg2')}  ${p(d.setup.url === '' ? 'empty tab' : displayUrl(d.setup.url), 'accent')}`
        : ` ${p('No browser', 'fg2')}`;
    return [
      line(title, p(`${d.id} • ${formatDuration(duration)} `, 'fg2')),
      line(
        ` ${p('Session', 'fg2')} ${p(d.name ?? 'untitled', { tone: 'fg1', bold: true })}`,
        `${status}  `,
      ),
      line(third),
      blank(),
    ];
  }

  const background = live !== null && live.session.status === 'recording' ? live.session : null;
  return [
    line(
      title,
      p(
        background === null
          ? 'no session '
          : `${background.id} • ${clock(elapsed(state, background.startedAt))} `,
        'fg2',
      ),
    ),
    line(
      ` ${p('Project', 'fg2')} ${p(state.project.cwd, 'fg1')}`,
      `${background === null ? p('READY', { tone: 'info', bold: true }) : p('● REC', { tone: 'err', bold: true })}  `,
    ),
    line(` ${p('Store', 'fg2')}   ${p(state.storePath, 'fg3')}`),
    blank(),
  ];
}
