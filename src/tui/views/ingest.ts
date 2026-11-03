import type { EndpointView } from '../../core/api.ts';
import { ago, parseTime, timeOfDay } from '../format.ts';
import { blank, type Line, line } from '../layout.ts';
import type { IngestOverlay, TuiState } from '../state.ts';
import { inputText, plural, type View } from './common.ts';
import { projectName } from './header.ts';

export function linkedEndpoint(state: TuiState): string | null {
  const live = state.live;
  if (live === null || live.session.status !== 'recording') return null;
  return live.session.endpoint?.name ?? null;
}

function closedText(ep: EndpointView): string {
  return ep.closedReason === 'idle' ? 'closed after 24 h idle' : 'closed by you';
}

export function ingestLines(view: View, overlay: IngestOverlay): Line[] {
  const { theme, state, width, height } = view;
  const p = theme.paint;
  const eps = state.endpoints;
  overlay.index = Math.min(overlay.index, Math.max(0, eps.length - 1));
  const open = eps.filter((ep) => ep.state === 'open').length;
  const linked = linkedEndpoint(state);
  const out: Line[] = [
    blank(),
    line(
      `   ${p('Ingest endpoints', { tone: 'fg1', bold: true })}  ${p(projectName(state), 'fg3')}`,
      `${p(`${open} open · ${eps.length} total`, 'fg3')}   `,
    ),
    line(`   ${p('One per session · closes after 24 h idle · the URL never changes', 'fg3')}`),
    blank(),
  ];
  const creating = overlay.naming === 'new';
  eps.forEach((ep, index) => {
    const on = index === overlay.index && !creating;
    const isOpen = ep.state === 'open';
    const deleting = overlay.confirmDelete === ep.name;
    const name =
      overlay.naming === ep.name
        ? inputText(theme, state.input, 24)
        : p(ep.name.padEnd(10), {
            tone: deleting ? 'bug' : on || isOpen ? 'fg1' : 'fg3',
            bold: on || deleting,
          });
    const last = parseTime(ep.lastEventAt);
    const right = isOpen
      ? `${p(plural(ep.eventCount, 'event'), 'fg2')} ${p(`· ${last === null ? 'nothing yet' : ago(state.now - last)}`, 'fg3')}${linked === ep.name ? ` ${p('● session', 'err')}` : ''}`
      : p(closedText(ep), 'fg3');
    out.push(
      line(
        `   ${on ? p('▌', { tone: 'accent', bold: true }) : ' '} ${isOpen ? p('●', 'ingest') : p('○', 'fg3')} ${name} ${p(ep.url, isOpen ? 'accent' : 'fg3')}`,
        `${right}   `,
        on ? 'prompt' : undefined,
      ),
    );
  });
  if (creating) {
    out.push(
      line(
        `   ${p('▌', { tone: 'accent', bold: true })} ${p('+', 'ingest')} ${inputText(theme, state.input, 24)}`,
        `${p('name, then Enter', 'fg3')}   `,
        'prompt',
      ),
    );
  }
  if (eps.length === 0 && !creating) {
    out.push(
      line(
        `   ${p('No endpoints yet. Ctrl+N creates one, or /new … #name creates it when the session starts.', 'fg3')}`,
      ),
    );
  }
  const ep = eps[overlay.index];
  if (ep !== undefined && !creating) {
    const title = ep.state === 'open' ? `${ep.name} · live` : `${ep.name} · last events`;
    out.push(
      blank(),
      line(`   ${p(title, 'fg2')}  ${p('─'.repeat(Math.max(0, width - title.length - 8)), 'fg3')}`),
    );
    const room = Math.max(3, height - out.length);
    const events = overlay.eventsFor === ep.name ? overlay.events.slice(-room) : [];
    if (events.length === 0) out.push(line(`   ${p('nothing received yet', 'fg3')}`));
    for (const event of events) {
      if (event.kind !== 'ingest') continue;
      const tone = event.level === 'error' ? 'failure' : event.level === 'warn' ? 'warn' : 'fg1';
      out.push(
        line(
          `   ${p(timeOfDay(parseTime(event.at) ?? 0), 'fg3')}  ${p(event.level.padEnd(6), event.level === 'error' ? 'failure' : 'ingest')}${p(event.message, tone)}`,
          `${p(event.source ?? '', 'fg3')}   `,
        ),
      );
    }
  }
  return out;
}
