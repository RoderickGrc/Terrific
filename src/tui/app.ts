import { setTimeout as delay } from 'node:timers/promises';
import { type Component, type Focusable, Key, matchesKey } from '@earendil-works/pi-tui';
import type { DaemonClient } from '../client/daemon-client.ts';
import {
  MAX_EVENT_LIMIT,
  type ProjectSettingsView,
  type SessionDetail,
  type SessionView,
  type SettingsPatchRequest,
} from '../core/api.ts';
import { endpointInstructions } from '../core/copy-payloads.ts';
import type { TerrificEvent } from '../core/events.ts';
import { approxTokens, formatBytes, formatTokens } from '../core/format.ts';
import { parseNewLine } from '../core/new-command.ts';
import { applySuggestion, type SuggestContext, suggestNew } from '../core/new-suggestions.ts';
import { isStoredEvent } from '../core/session.ts';
import {
  copySetup,
  defaultEndpoint,
  isEndpointName,
  isUrlWord,
  normalizeUrl,
  type SessionSetup,
} from '../core/setup.ts';
import { toEndpointOption, toProfileOption } from '../core/view-options.ts';
import {
  availableCommands,
  COMMANDS,
  type CommandName,
  type CommandSpec,
  findCommand,
  paletteMatches,
  splitCommand,
} from './commands.ts';
import { InputLine } from './input-line.ts';
import { blank, type Line, line, renderLine } from './layout.ts';
import { LiveLog } from './live-log.ts';
import {
  type IngestOverlay,
  isBrowserSession,
  isModal,
  type NewField,
  type NewOverlay,
  newFields,
  type PickerItem,
  type PickerOverlay,
  RECORD_KEYS,
  type SessionsOverlay,
  type SettingsOverlay,
  type TuiState,
} from './state.ts';
import type { Theme, Tone } from './theme.ts';
import { hints, inputText, placeholderText, type View } from './views/common.ts';
import { headerLines, profileLabel } from './views/header.ts';
import { homeLines } from './views/home.ts';
import { ingestLines, linkedEndpoint } from './views/ingest.ts';
import { liveLines, liveStats } from './views/live.ts';
import {
  type Assist,
  assistLines,
  confirmLines,
  endpointChoices,
  NEW_PREFIX,
} from './views/new.ts';
import {
  filteredItems,
  helpLines,
  itemLines,
  paletteLines,
  settingsItems,
  stopLines,
} from './views/panels.ts';
import { sessionRows, sessionsLines } from './views/sessions.ts';
import { sameSetup, summaryLines } from './views/summary.ts';

export type AppDeps = {
  client: DaemonClient;
  theme: Theme;
  rows(): number;
  requestRender(): void;
  copy(text: string): Promise<boolean>;
  quit(): void;
};

export type AppData = Pick<
  TuiState,
  'project' | 'storePath' | 'settings' | 'profiles' | 'endpoints' | 'sessions'
>;

const TOAST_MS = 2600;
const CTRL_C_MS = 3000;
const REFRESH_MS = 5000;
const ENDPOINT_BACKLOG = 50;
const STOP_STATES = new Set(['stopped', 'interrupted', 'browser-closed']);
const STOP_WAIT_MS = 5000;
const STOP_POLL_MS = 100;
const EDITOR_ROWS = 4;
const FOOTER_ROWS = 3;
const MIN_BODY_ROWS = 2;

const RECORD_DETAIL = {
  actions: 'clicks, typing, selects',
  network: 'requests and responses',
  console: 'browser console output',
} as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseEvent(data: string): TerrificEvent | undefined {
  try {
    const value: unknown = JSON.parse(data);
    return isStoredEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function step(index: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (index + delta + length) % length;
}

function nextSelectable(items: PickerItem[], index: number, delta: number): number {
  let i = index;
  for (let n = 0; n < items.length; n += 1) {
    i = step(i, delta, items.length);
    if (items[i]?.heading !== true) return i;
  }
  return index;
}

/** Keeps a panel inside its room, showing the highlighted row when it has to cut. */
function windowAround(lines: Line[], room: number): Line[] {
  if (lines.length <= room) return lines;
  const picked = lines.findIndex((item) => item.fill === 'pick');
  const start =
    picked < 0 ? 0 : Math.max(0, Math.min(picked - Math.floor(room / 2), lines.length - room));
  return lines.slice(start, start + room);
}

/** The whole screen as one component: header, body, panel, input and footer. */
export class TuiApp implements Component, Focusable {
  focused = false;
  readonly state: TuiState;
  private readonly deps: AppDeps;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private refresher: ReturnType<typeof setInterval> | undefined;
  private sessionStream: AbortController | undefined;
  private endpointStream: AbortController | undefined;

  constructor(deps: AppDeps, data: AppData) {
    this.deps = deps;
    this.state = {
      ...data,
      screen: 'home',
      legacy: null,
      live: null,
      summary: null,
      overlay: null,
      input: new InputLine(),
      paletteIndex: 0,
      suggestionIndex: 0,
      toast: null,
      now: Date.now(),
      ctrlCAt: 0,
    };
  }

  start(running: SessionView | null): void {
    if (running !== null) this.attach(running, false);
    this.ticker = setInterval(() => {
      this.state.now = Date.now();
      this.deps.requestRender();
    }, 1000);
    this.refresher = setInterval(() => {
      if (this.state.screen !== 'home' && this.state.overlay?.type !== 'ingest') return;
      const { client } = this.deps;
      // Profiles too, so ones added with `terrific profiles add` show up without a restart.
      Promise.all([client.listEndpoints(this.state.project.id), client.listProfiles()])
        .then(([endpoints, profiles]) => {
          this.state.endpoints = endpoints;
          this.state.profiles = profiles;
          this.deps.requestRender();
        })
        .catch(() => undefined);
    }, REFRESH_MS);
  }

  dispose(): void {
    clearInterval(this.ticker);
    clearInterval(this.refresher);
    clearTimeout(this.toastTimer);
    this.sessionStream?.abort();
    this.endpointStream?.abort();
  }

  invalidate(): void {}

  // ---------- rendering ----------

  render(width: number): string[] {
    const { theme } = this.deps;
    const state = this.state;
    const height = this.deps.rows();
    const view: View = { theme, state, width, height };
    const header = headerLines(theme, state);
    const modal = isModal(state.overlay);
    const footer = [line(` ${this.hintsText()}`), this.toastLine()];
    let bottom: Line[] = footer;
    if (!modal) {
      const room = Math.max(0, height - header.length - EDITOR_ROWS - FOOTER_ROWS - MIN_BODY_ROWS);
      const panel = windowAround(this.panelLines({ ...view, height: room }), room);
      const stats = line(`  ${this.statsText(view)}`, '', 'stats');
      bottom = [...panel, ...this.editorLines(width), stats, ...footer];
    }
    const bodyView: View = {
      ...view,
      height: Math.max(0, height - header.length - bottom.length),
    };
    let body = modal ? this.modalLines(bodyView) : this.screenLines(bodyView);
    const summary = state.summary;
    if (state.screen === 'summary' && !modal && summary !== null) {
      summary.scroll = Math.min(summary.scroll, Math.max(0, body.length - bodyView.height));
      body = body.slice(summary.scroll);
    }
    body = body.slice(0, bodyView.height);
    while (body.length < bodyView.height) body.push(blank());
    return [...header, ...body, ...bottom]
      .slice(0, height)
      .map((item) => renderLine(theme, item, width));
  }

  private screenLines(view: View): Line[] {
    const state = this.state;
    if (state.screen === 'live' && state.live !== null) return liveLines(view, state.live);
    if (state.screen === 'summary' && state.summary !== null) {
      return summaryLines(view, state.summary);
    }
    return homeLines(view);
  }

  private modalLines(view: View): Line[] {
    const overlay = this.state.overlay;
    if (overlay?.type === 'new') return confirmLines(view, overlay);
    if (overlay?.type === 'sessions') return sessionsLines(view, overlay);
    if (overlay?.type === 'ingest') return ingestLines(view, overlay);
    if (overlay?.type === 'help') return helpLines(view);
    return [];
  }

  private panelLines(view: View): Line[] {
    const state = this.state;
    const overlay = state.overlay;
    if (overlay?.type === 'stop' && state.live !== null) return stopLines(view, state.live);
    if (overlay?.type === 'picker') {
      const items = filteredItems(overlay, state.input.value);
      return itemLines(view, overlay.title, items, overlay.index);
    }
    if (overlay?.type === 'settings') {
      return itemLines(view, 'Settings', settingsItems(state), overlay.index);
    }
    const assist = this.assist();
    if (assist !== null) return assistLines(view, assist);
    const matches = this.palette();
    return matches.length > 0 ? paletteLines(view, matches) : [];
  }

  private editorLines(width: number): Line[] {
    const { theme } = this.deps;
    const p = theme.paint;
    const state = this.state;
    const overlay = state.overlay;
    let label = p('Command', { tone: 'fg1', bold: true });
    let right = `${p('/new', 'fg2')} ${p('start a session', { tone: 'ok', bold: true })} `;
    let placeholder =
      state.screen === 'summary'
        ? 'Type a command. /new starts another session'
        : 'Type a command. /new starts a session';
    if (overlay?.type === 'stop') {
      label = p('Session name', { tone: 'fg1', bold: true });
      right = `${p('Enter', { tone: 'ok', bold: true })} ${p('stop', 'fg2')}  ${p('Esc', 'fg2')} ${p('keep recording', 'fg3')} `;
      placeholder = 'untitled';
    } else if (overlay !== null) {
      const filter = overlay.type === 'picker' && overlay.filter;
      label = filter ? p('Filter', { tone: 'fg1', bold: true }) : '';
      right = '';
      placeholder = filter ? 'Type to filter' : '';
    } else if (state.screen === 'live') {
      label = p('Note', { tone: 'fg1', bold: true });
      right = `${p('Enter', 'fg2')} ${p('note', 'fg3')}  ${p('Ctrl+Enter', 'fg2')} ${p('bug', { tone: 'bug', bold: true })}  ${p('Ctrl+Shift+Enter', 'fg2')} ${p('flag', { tone: 'flag', bold: true })} `;
      placeholder = 'Write a note. Ctrl+Enter marks a bug, text optional';
    }
    const text =
      state.input.value === ''
        ? placeholderText(theme, placeholder)
        : inputText(theme, state.input, width - 8);
    return [
      line(` ${label}`, right),
      blank('editor'),
      line(`${p('  › ', 'accent')}${text}`, '', 'editor'),
      blank('editor'),
    ];
  }

  private statsText(view: View): string {
    const { theme } = this.deps;
    const state = this.state;
    if (state.screen === 'live' && state.live !== null) return liveStats(theme, view, state.live);
    if (state.screen === 'summary' && state.summary !== null) {
      return theme.paint(sameSetup(state.summary.detail), 'fg2');
    }
    const last = state.settings.lastSetup;
    const endpoint = defaultEndpoint(last.endpoint, state.endpoints.map(toEndpointOption));
    const records = RECORD_KEYS.filter((key) => last.record[key]).join(', ') || 'nothing';
    const from =
      last.target === 'browser'
        ? `browser · ${profileLabel(state, last.profile)} (@${last.profile}) · records ${records}`
        : 'no browser';
    const ingest = endpoint === null ? '' : ` · ingest ${endpoint}`;
    return theme.paint(`/new starts from: ${from}${ingest}`, 'fg2');
  }

  private hintsText(): string {
    const { theme } = this.deps;
    const state = this.state;
    const overlay = state.overlay;
    const live = state.live;
    if (overlay?.type === 'new') {
      return hints(theme, [
        ['↑↓', 'field'],
        ['←→', 'change'],
        ['Space', 'toggle'],
        ['Enter', 'start'],
        ['Esc', 'cancel'],
      ]);
    }
    if (overlay?.type === 'sessions') {
      if (overlay.renaming !== null) {
        return hints(theme, [
          ['Enter', 'save name'],
          ['Esc', 'cancel'],
        ]);
      }
      return hints(theme, [
        ['↑↓', 'move'],
        ['Enter', 'open'],
        ['Ctrl+F', 'pin'],
        ['Ctrl+R', 'rename'],
        ['Ctrl+D', 'delete'],
        ['Esc', 'close'],
      ]);
    }
    if (overlay?.type === 'ingest') {
      if (overlay.naming !== null) {
        return hints(theme, [
          ['Enter', 'save'],
          ['Esc', 'cancel'],
        ]);
      }
      return hints(theme, [
        ['↑↓', 'move'],
        ['Enter', 'copy URL'],
        ['Space', 'open/close'],
        ['Ctrl+N', 'new'],
        ['Ctrl+R', 'rename'],
        ['Ctrl+D', 'delete'],
        ['Esc', 'close'],
      ]);
    }
    if (overlay?.type === 'stop') {
      return hints(theme, [
        ['type', 'rename'],
        ['Enter', 'stop and save'],
        ['Esc', 'keep recording'],
      ]);
    }
    if (overlay?.type === 'help') return hints(theme, [['Esc', 'close']]);
    if (overlay?.type === 'settings') {
      return hints(theme, [
        ['↑↓', 'move'],
        ['Space', 'toggle'],
        ['Enter', 'select'],
        ['Esc', 'close'],
      ]);
    }
    if (overlay?.type === 'picker') {
      const pairs: [string, string][] = [['↑↓', 'move']];
      if (overlay.multi) pairs.push(['Space', 'toggle']);
      if (overlay.filter) pairs.push(['type', 'filter']);
      pairs.push(['Enter', overlay.multi ? 'done' : 'select'], ['Esc', 'close']);
      return hints(theme, pairs);
    }
    if (this.assist() !== null) {
      return hints(theme, [
        ['Tab', 'complete'],
        ['↑↓', 'choose'],
        ['Enter', 'review'],
        ['Esc', 'clear'],
      ]);
    }
    if (this.palette().length > 0) {
      return hints(theme, [
        ['↑↓', 'choose'],
        ['Tab', 'complete'],
        ['Enter', 'run'],
        ['Esc', 'cancel'],
      ]);
    }
    if (state.screen === 'live' && live !== null) {
      if (live.selected !== null) {
        return hints(theme, [
          ['↑↓', 'move'],
          ['Enter', 'expand'],
          ['Esc', 'back to live'],
        ]);
      }
      const capture: [string, string][] = isBrowserSession(live)
        ? [
            ['F5', 'screenshot'],
            ['F6', 'snapshot'],
          ]
        : [];
      return hints(theme, [
        ['/', 'commands'],
        ['↑', 'inspect'],
        ...capture,
        ['/stop', 'end'],
        ['Ctrl+C', 'quit'],
      ]);
    }
    if (state.screen === 'summary') {
      return hints(theme, [
        ['/', 'commands'],
        ['Esc', 'home'],
        ['Ctrl+C', 'quit'],
      ]);
    }
    // Home already shows /new beside the input and /sessions above the list.
    return '';
  }

  private toastLine(): Line {
    const toast = this.state.toast;
    if (toast === null) return blank();
    return line(` ${this.deps.theme.paint(toast.text, { tone: toast.tone, bold: true })}`);
  }

  // ---------- derived state ----------

  private recording(): boolean {
    return this.state.live?.session.status === 'recording';
  }

  private available(): CommandSpec[] {
    return availableCommands({
      screen: this.state.screen,
      browser: isBrowserSession(this.state.live),
      background: this.recording() && this.state.screen !== 'live',
    });
  }

  private palette(): CommandSpec[] {
    if (this.state.overlay !== null) return [];
    return paletteMatches(this.state.input.value, this.available());
  }

  private newContext(): SuggestContext {
    const state = this.state;
    const last = state.settings.lastSetup;
    return {
      last,
      profiles: state.profiles.map(toProfileOption),
      endpoints: state.endpoints.map(toEndpointOption),
      recentUrls: last.url === '' ? [] : [last.url],
    };
  }

  private assist(): Assist | null {
    const state = this.state;
    if (state.overlay !== null || state.screen === 'live') return null;
    if (!state.input.value.toLowerCase().startsWith(NEW_PREFIX)) return null;
    const context = this.newContext();
    const parsed = parseNewLine(state.input.value.slice(NEW_PREFIX.length), context);
    const caret = Math.max(0, state.input.caret - NEW_PREFIX.length);
    const suggestions = suggestNew(parsed, caret, context);
    state.suggestionIndex = Math.min(state.suggestionIndex, Math.max(0, suggestions.length - 1));
    return { parsed, caret, suggestions };
  }

  // ---------- effects ----------

  private toast(tone: Tone, text: string): void {
    this.state.toast = { tone, text };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.state.toast = null;
      this.deps.requestRender();
    }, TOAST_MS);
  }

  private run(task: () => Promise<void>): void {
    task()
      .catch((error: unknown) => this.toast('err', message(error)))
      .finally(() => this.deps.requestRender());
  }

  private async patchSettings(patch: SettingsPatchRequest): Promise<ProjectSettingsView> {
    const next = await this.deps.client.patchSettings(this.state.project.id, patch);
    this.state.settings = next;
    return next;
  }

  private async refreshLists(): Promise<void> {
    const { client } = this.deps;
    const [endpoints, sessions] = await Promise.all([
      client.listEndpoints(this.state.project.id),
      client.listSessions(this.state.project.id),
    ]);
    this.state.endpoints = endpoints;
    this.state.sessions = sessions;
  }

  private attach(session: SessionView, show: boolean): void {
    const state = this.state;
    state.live = { session, log: new LiveLog(), selected: null, scroll: 0, unseen: 0 };
    if (show) state.screen = 'live';
    this.sessionStream?.abort();
    const controller = new AbortController();
    this.sessionStream = controller;
    const { client } = this.deps;
    const follow = async (): Promise<void> => {
      // Subscribe before reading the backlog so nothing lands in the gap; ids remove duplicates.
      const stream = client.sessionStream(session.id, controller.signal);
      const first = stream.next();
      const backlog = await client.queryEvents(session.id, { limit: MAX_EVENT_LIMIT });
      for (const event of backlog) this.onEvent(session.id, event);
      this.deps.requestRender();
      let next = await first;
      while (!next.done) {
        const event = parseEvent(next.value.data);
        if (event !== undefined) this.onEvent(session.id, event);
        next = await stream.next();
      }
    };
    follow().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      this.toast('err', message(error));
      this.deps.requestRender();
    });
  }

  private onEvent(sessionId: string, event: TerrificEvent): void {
    const live = this.state.live;
    if (live === null || live.session.id !== sessionId) return;
    const added = live.log.add(event);
    if (added && live.scroll > 0) live.unseen += 1;
    if (event.kind === 'lifecycle' && STOP_STATES.has(event.state)) {
      const note =
        event.state === 'browser-closed'
          ? 'Browser closed, the session stopped'
          : 'The session stopped';
      this.run(() => this.finish(sessionId, note));
    }
    this.deps.requestRender();
  }

  /** Leaves the live screen for the summary once a session stops, whoever stopped it. */
  private async finish(sessionId: string, note: string | null): Promise<void> {
    const state = this.state;
    const live = state.live;
    if (live === null || live.session.id !== sessionId) return;
    state.live = null;
    this.sessionStream?.abort();
    const watching = state.screen === 'live';
    if (state.overlay?.type === 'stop') this.closeOverlay();
    const detail = await this.stoppedDetail(sessionId);
    await this.refreshLists();
    if (watching) {
      state.summary = { detail, blocks: [], scroll: 0 };
      state.screen = 'summary';
    }
    if (note !== null) this.toast('info', watching ? note : `${note}: ${detail.name ?? detail.id}`);
  }

  // The daemon streams the stop event before it marks the session stopped and writes its context file.
  private async stoppedDetail(id: string): Promise<SessionDetail> {
    const deadline = Date.now() + STOP_WAIT_MS;
    let detail = await this.deps.client.getSession(id);
    while (detail.status === 'recording' && Date.now() < deadline) {
      await delay(STOP_POLL_MS);
      detail = await this.deps.client.getSession(id);
    }
    return detail;
  }

  private openSummary(id: string): void {
    this.run(async () => {
      const detail = await this.deps.client.getSession(id);
      this.state.summary = { detail, blocks: [], scroll: 0 };
      this.state.screen = 'summary';
      this.closeOverlay();
    });
  }

  private closeOverlay(): void {
    if (this.state.overlay?.type === 'ingest') this.endpointStream?.abort();
    this.state.overlay = null;
    this.state.input.clear();
  }

  // ---------- input ----------

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl('c'))) this.ctrlC();
    else if (this.state.overlay !== null) this.overlayKey(data);
    else this.mainKey(data);
    this.deps.requestRender();
  }

  private ctrlC(): void {
    const state = this.state;
    if (state.overlay !== null) {
      this.closeOverlay();
      return;
    }
    const now = Date.now();
    if (now - state.ctrlCAt < CTRL_C_MS) {
      this.deps.quit();
      return;
    }
    state.ctrlCAt = now;
    this.toast(
      'warn',
      this.recording()
        ? 'Press Ctrl+C again to quit. Recording keeps running in the background.'
        : 'Press Ctrl+C again to quit',
    );
  }

  private mainKey(data: string): void {
    const state = this.state;
    const live = state.screen === 'live' ? state.live : null;
    if (live !== null && this.liveShortcut(data)) return;
    const assist = this.assist();
    if (assist !== null && this.assistKey(assist, data)) return;
    const matches = this.palette();
    if (matches.length > 0 && this.paletteKey(matches, data)) return;

    if (matchesKey(data, Key.escape)) {
      if (live !== null && live.selected !== null) {
        live.selected = null;
        live.scroll = 0;
        live.unseen = 0;
      } else if (state.input.value !== '') {
        state.input.clear();
      } else if (state.screen === 'summary') {
        state.screen = 'home';
        state.summary = null;
      }
      return;
    }
    if (live !== null && state.input.value === '' && this.inspectKey(data)) return;
    if (this.scrollKey(data)) return;
    if (matchesKey(data, Key.enter)) {
      this.submit(matches[state.paletteIndex]);
      return;
    }
    if (state.input.handle(data)) {
      state.paletteIndex = 0;
      state.suggestionIndex = 0;
      if (live !== null) live.selected = null;
    }
  }

  /** F5, F6, Ctrl+Enter and Ctrl+Shift+Enter while the live screen is open. */
  private liveShortcut(data: string): boolean {
    const state = this.state;
    if (isBrowserSession(state.live)) {
      if (matchesKey(data, Key.f5)) {
        this.execute('screenshot', '');
        return true;
      }
      if (matchesKey(data, Key.f6)) {
        this.execute('snapshot', '');
        return true;
      }
    }
    const flag = matchesKey(data, Key.ctrlShift('enter'));
    if (flag || matchesKey(data, Key.ctrl('enter'))) {
      const text = state.input.value.trim();
      state.input.clear();
      this.mark(flag ? 'flag' : 'bug', text);
      return true;
    }
    return false;
  }

  private assistKey(assist: Assist, data: string): boolean {
    const state = this.state;
    const count = assist.suggestions.length;
    if (count > 0 && (matchesKey(data, Key.down) || matchesKey(data, Key.up))) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      state.suggestionIndex = step(state.suggestionIndex, delta, count);
      return true;
    }
    if (matchesKey(data, Key.tab)) {
      const suggestion = assist.suggestions[state.suggestionIndex];
      if (suggestion !== undefined && suggestion.disabled !== true) {
        const raw = state.input.value.slice(NEW_PREFIX.length);
        const next = applySuggestion(raw, assist.caret, assist.parsed, suggestion);
        state.input.set(NEW_PREFIX + next.line);
        state.input.caret = NEW_PREFIX.length + next.caret;
        state.suggestionIndex = 0;
      }
      return true;
    }
    if (matchesKey(data, Key.enter)) {
      const dropped = assist.parsed.tokens.filter((token) => token.problem?.severity === 'invalid');
      state.input.clear();
      this.openNew(assist.parsed.setup, assist.parsed.name);
      if (dropped.length > 0) {
        this.toast('warn', `Ignored: ${dropped.map((token) => token.text).join(', ')}`);
      }
      return true;
    }
    return false;
  }

  private paletteKey(matches: CommandSpec[], data: string): boolean {
    const state = this.state;
    if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      state.paletteIndex = step(state.paletteIndex, delta, matches.length);
      return true;
    }
    if (matchesKey(data, Key.tab)) {
      const chosen = matches[state.paletteIndex];
      if (chosen !== undefined) {
        state.input.set(`/${chosen.name}${chosen.args === undefined ? '' : ' '}`);
      }
      state.paletteIndex = 0;
      return true;
    }
    return false;
  }

  /** Up and Down walk the log with an empty input; Enter expands the line. */
  private inspectKey(data: string): boolean {
    const state = this.state;
    const live = state.live;
    if (live === null) return false;
    const visible = live.log.visible(state.settings.visibility);
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      if (visible.length === 0) return true;
      const current = live.selected ?? visible.length;
      const next = matchesKey(data, Key.up) ? Math.max(0, current - 1) : current + 1;
      if (next >= visible.length) {
        live.selected = null;
        live.scroll = 0;
        live.unseen = 0;
      } else {
        live.selected = next;
      }
      return true;
    }
    if (matchesKey(data, Key.enter) && live.selected !== null) {
      const entry = visible[live.selected];
      if (entry !== undefined) entry.expanded = !entry.expanded;
      return true;
    }
    return false;
  }

  private scrollKey(data: string): boolean {
    const state = this.state;
    const live = state.screen === 'live' ? state.live : null;
    const page = Math.max(1, this.deps.rows() - 16);
    const up = matchesKey(data, Key.pageUp);
    if (up || matchesKey(data, Key.pageDown)) {
      if (live !== null) {
        live.scroll = Math.max(0, live.scroll + (up ? page : -page));
        if (live.scroll === 0) live.unseen = 0;
      } else if (state.screen === 'summary' && state.summary !== null) {
        state.summary.scroll = Math.max(0, state.summary.scroll + (up ? -page : page));
      }
      return true;
    }
    if (matchesKey(data, Key.end) && state.input.value === '' && live !== null) {
      live.scroll = 0;
      live.unseen = 0;
      live.selected = null;
      return true;
    }
    return false;
  }

  private submit(selection: CommandSpec | undefined): void {
    const state = this.state;
    const text = state.input.value.trim();
    if (text === '') return;
    state.input.clear();
    state.paletteIndex = 0;
    if (text.startsWith('/')) {
      this.runCommand(text, selection);
    } else if (state.screen === 'live') {
      this.mark('note', text);
    } else if (isUrlWord(text)) {
      // Home and summary expect commands. A pasted URL becomes `/new <url>` so the parser shows what it read.
      state.input.set(`${NEW_PREFIX}${text} `);
    } else if (findCommand(splitCommand(text).word, this.available()) !== undefined) {
      this.runCommand(`/${text}`, undefined);
    } else {
      this.toast('warn', 'Commands start with /. Try /new to start a session');
    }
  }

  private runCommand(text: string, selection: CommandSpec | undefined): void {
    const { word, args } = splitCommand(text);
    let command = findCommand(word, this.available());
    if (command === undefined && selection !== undefined && args === '') command = selection;
    if (command !== undefined) {
      this.execute(command.name, args);
      return;
    }
    const exists = findCommand(word, COMMANDS);
    this.toast(
      'warn',
      exists !== undefined
        ? `/${exists.name} is not available here`
        : `Unknown command /${word}. Type / to see commands`,
    );
  }

  private execute(name: CommandName, args: string): void {
    const state = this.state;
    const live = state.live;
    switch (name) {
      case 'new': {
        const parsed = parseNewLine(args, this.newContext());
        this.openNew(parsed.setup, parsed.name);
        break;
      }
      case 'sessions':
        this.openSessions(args);
        break;
      case 'ingest':
        this.openIngest();
        break;
      case 'attach':
        if (live !== null) {
          state.screen = 'live';
          live.scroll = 0;
          live.unseen = 0;
        }
        break;
      case 'profile':
        this.pickProfile();
        break;
      case 'record':
        this.pickRecord();
        break;
      case 'note':
        if (args === '') this.toast('warn', 'Usage: /note <text>');
        else this.mark('note', args);
        break;
      case 'bug':
      case 'flag':
        this.mark(name, args);
        break;
      case 'screenshot':
      case 'snapshot':
        this.capture(name);
        break;
      case 'name':
        this.rename(args);
        break;
      case 'copy':
        this.pickCopy();
        break;
      case 'export':
        this.exportContext();
        break;
      case 'stop':
        if (live !== null) {
          state.overlay = { type: 'stop' };
          state.input.set(live.session.name ?? '', { selected: true });
        }
        break;
      case 'settings':
        state.overlay = { type: 'settings', index: 1 };
        state.input.clear();
        break;
      case 'help':
        state.overlay = { type: 'help' };
        break;
      case 'quit':
        this.deps.quit();
        break;
    }
  }

  private mark(kind: 'note' | 'bug' | 'flag', text: string): void {
    const live = this.state.live;
    if (live === null || (kind === 'note' && text === '')) return;
    this.run(async () => {
      await this.deps.client.addMark(live.session.id, { kind, text: text === '' ? null : text });
    });
  }

  private capture(kind: 'screenshot' | 'snapshot'): void {
    const live = this.state.live;
    if (live === null) return;
    const { client } = this.deps;
    this.run(async () => {
      if (kind === 'screenshot') await client.screenshot(live.session.id);
      else await client.snapshot(live.session.id);
    });
  }

  private rename(name: string): void {
    const state = this.state;
    const { client } = this.deps;
    if (name === '') {
      this.toast('warn', 'Usage: /name <name>');
      return;
    }
    const live = state.screen === 'live' ? state.live : null;
    if (live !== null) {
      this.run(async () => {
        live.session = await client.renameSession(live.session.id, name);
        this.toast('ok', 'Session renamed');
      });
      return;
    }
    const summary = state.summary;
    if (summary === null) return;
    if (summary.detail.legacy) {
      this.toast('warn', 'Legacy sessions are read only');
      return;
    }
    this.run(async () => {
      const view = await client.renameSession(summary.detail.id, name);
      summary.detail = { ...summary.detail, name: view.name };
      this.toast('ok', 'Session renamed');
    });
  }

  private exportContext(): void {
    const summary = this.state.summary;
    if (summary === null) return;
    this.run(async () => {
      const written = await this.deps.client.writeContext(summary.detail.id);
      summary.detail = { ...summary.detail, contextBytes: written.bytes };
      summary.blocks.push({
        title: 'Context written',
        lines: [
          written.path,
          `${formatBytes(written.bytes)} · ${formatTokens(approxTokens(written.bytes))}`,
        ],
        ok: true,
      });
      summary.scroll = Number.MAX_SAFE_INTEGER;
      this.toast('ok', 'Context file written');
    });
  }

  // ---------- /new confirmation ----------

  private openNew(setup: SessionSetup, name: string): void {
    if (this.recording()) {
      this.toast('warn', 'A session is already recording. /attach to it, or /stop it first.');
      return;
    }
    const overlay: NewOverlay = {
      type: 'new',
      setup: copySetup(setup),
      name,
      field: 0,
      recordIndex: 0,
    };
    this.state.overlay = overlay;
    this.syncNewInput(overlay);
  }

  private newField(overlay: NewOverlay): NewField {
    const fields = newFields(overlay.setup);
    overlay.field = Math.min(overlay.field, fields.length - 1);
    return fields[overlay.field] ?? 'target';
  }

  private syncNewInput(overlay: NewOverlay): void {
    const field = this.newField(overlay);
    if (field === 'url') this.state.input.set(overlay.setup.url);
    else if (field === 'name') this.state.input.set(overlay.name);
    else this.state.input.clear();
  }

  private newKey(overlay: NewOverlay, data: string): void {
    const state = this.state;
    const fields = newFields(overlay.setup);
    const field = this.newField(overlay);
    const setup = overlay.setup;
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      return;
    }
    const down = matchesKey(data, Key.down) || matchesKey(data, Key.tab);
    if (down || matchesKey(data, Key.up) || matchesKey(data, Key.shift('tab'))) {
      overlay.field = step(overlay.field, down ? 1 : -1, fields.length);
      this.syncNewInput(overlay);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.startFromConfirm(overlay);
      return;
    }
    if (field === 'url' || field === 'name') {
      if (!state.input.handle(data)) return;
      if (field === 'url') setup.url = state.input.value;
      else overlay.name = state.input.value;
      return;
    }
    const delta = matchesKey(data, Key.right) ? 1 : matchesKey(data, Key.left) ? -1 : 0;
    const space = matchesKey(data, Key.space);
    if (delta === 0 && !space) return;
    if (field === 'target') {
      setup.target = setup.target === 'browser' ? 'none' : 'browser';
      if (setup.target === 'none' && setup.endpoint === null) {
        const options = state.endpoints.map(toEndpointOption);
        setup.endpoint = defaultEndpoint(state.settings.lastSetup.endpoint, options) ?? 'main';
      }
    } else if (field === 'profile') {
      if (space) {
        this.pickProfile(overlay);
        return;
      }
      const usable = state.profiles.filter((profile) => profile.blockedReason === null);
      const at = Math.max(
        0,
        usable.findIndex((profile) => profile.slug === setup.profile),
      );
      const next = usable[step(at, delta, usable.length)];
      if (next !== undefined) setup.profile = next.slug;
    } else if (field === 'record') {
      const key = RECORD_KEYS[overlay.recordIndex];
      if (space && key !== undefined) setup.record[key] = !setup.record[key];
      else overlay.recordIndex = step(overlay.recordIndex, delta, RECORD_KEYS.length);
    } else if (field === 'endpoint') {
      const choices = endpointChoices(state, setup);
      const at = Math.max(0, choices.indexOf(setup.endpoint ?? 'none'));
      const next = choices[step(at, delta === 0 ? 1 : delta, choices.length)] ?? 'none';
      setup.endpoint = next === 'none' ? null : next;
    }
  }

  private startFromConfirm(overlay: NewOverlay): void {
    const state = this.state;
    const setup = copySetup(overlay.setup);
    const url = setup.url.trim();
    setup.url = url;
    if (setup.target === 'browser' && url !== '') {
      if (!isUrlWord(url)) {
        overlay.field = newFields(setup).indexOf('url');
        this.syncNewInput(overlay);
        this.toast('warn', 'The URL does not look right. Clear it to open an empty tab');
        return;
      }
      setup.url = normalizeUrl(url);
    }
    if (setup.endpoint !== null && !isEndpointName(setup.endpoint)) {
      this.toast('warn', `"${setup.endpoint}" is not a valid endpoint name`);
      return;
    }
    const name = overlay.name.trim();
    this.closeOverlay();
    this.toast('info', setup.target === 'browser' ? 'Opening the browser…' : 'Starting…');
    this.run(async () => {
      const { client } = this.deps;
      const session = await client.startSession(state.project.id, {
        setup,
        name: name === '' ? null : name,
      });
      this.attach(session, true);
      state.toast = null;
      await this.patchSettings({ lastSetup: setup });
      state.endpoints = await client.listEndpoints(state.project.id);
    });
  }

  // ---------- overlays ----------

  private overlayKey(data: string): void {
    const overlay = this.state.overlay;
    if (overlay === null) return;
    switch (overlay.type) {
      case 'new':
        this.newKey(overlay, data);
        break;
      case 'sessions':
        this.sessionsKey(overlay, data);
        break;
      case 'ingest':
        this.ingestKey(overlay, data);
        break;
      case 'stop':
        this.stopKey(data);
        break;
      case 'picker':
        this.pickerKey(overlay, data);
        break;
      case 'settings':
        this.settingsKey(overlay, data);
        break;
      case 'help':
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) this.closeOverlay();
        break;
    }
  }

  private stopKey(data: string): void {
    const state = this.state;
    const live = state.live;
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      this.toast('info', 'Still recording');
      return;
    }
    if (!matchesKey(data, Key.enter) || live === null) {
      state.input.handle(data);
      return;
    }
    const name = state.input.value.trim();
    const id = live.session.id;
    this.closeOverlay();
    this.run(async () => {
      await this.deps.client.stopSession(id, { name: name === '' ? null : name });
      await this.finish(id, null);
    });
  }

  private openSessions(query: string): void {
    const state = this.state;
    state.overlay = { type: 'sessions', query, index: 0, renaming: null, confirmDelete: null };
    state.input.set(query);
    const { client } = this.deps;
    this.run(async () => {
      state.sessions = await client.listSessions(state.project.id);
      if (state.legacy === null) state.legacy = await client.listLegacySessions();
    });
  }

  private sessionsKey(overlay: SessionsOverlay, data: string): void {
    const state = this.state;
    if (overlay.renaming !== null) {
      this.renameSessionKey(overlay, data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      return;
    }
    const rows = sessionRows(state, overlay.query);
    if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      overlay.index = Math.max(0, Math.min(rows.length - 1, overlay.index + delta));
      overlay.confirmDelete = null;
      return;
    }
    const item = rows[overlay.index]?.item;
    const enter = matchesKey(data, Key.enter);
    const pin = matchesKey(data, Key.ctrl('f'));
    const rename = matchesKey(data, Key.ctrl('r'));
    const remove = matchesKey(data, Key.ctrl('d'));
    if (item === undefined || !(enter || pin || rename || remove)) {
      if (state.input.handle(data)) {
        overlay.query = state.input.value;
        overlay.index = 0;
        overlay.confirmDelete = null;
      }
      return;
    }
    if (enter) {
      if (state.live?.session.id === item.id && this.recording()) {
        this.closeOverlay();
        this.execute('attach', '');
      } else {
        this.openSummary(item.id);
      }
    } else if (pin) {
      const pinned = state.settings.pinned.includes(item.id)
        ? state.settings.pinned.filter((id) => id !== item.id)
        : [item.id, ...state.settings.pinned];
      this.run(async () => {
        await this.patchSettings({ pinned });
        const at = sessionRows(state, overlay.query).findIndex((row) => row.item.id === item.id);
        overlay.index = Math.max(0, at);
        this.toast('ok', pinned.includes(item.id) ? 'Pinned' : 'Unpinned');
      });
    } else if (item.legacy) {
      this.toast(
        'warn',
        rename
          ? 'Legacy sessions from terrific-web are read only'
          : 'Legacy sessions are read only and are never deleted from here.',
      );
    } else if (rename) {
      overlay.renaming = item.id;
      state.input.set(item.name ?? '');
    } else if (item.status === 'recording') {
      this.toast('warn', 'This session is recording. Stop it first.');
    } else if (overlay.confirmDelete !== item.id) {
      overlay.confirmDelete = item.id;
      this.toast('err', `Press Ctrl+D again to delete "${item.name ?? item.id}" and its folder`);
    } else {
      overlay.confirmDelete = null;
      this.deleteSession(item.id);
    }
  }

  private renameSessionKey(overlay: SessionsOverlay, data: string): void {
    const state = this.state;
    const id = overlay.renaming;
    if (id === null) return;
    const cancel = matchesKey(data, Key.escape);
    if (!cancel && !matchesKey(data, Key.enter)) {
      state.input.handle(data);
      return;
    }
    const name = state.input.value.trim();
    overlay.renaming = null;
    state.input.set(overlay.query);
    if (cancel || name === '') return;
    const { client } = this.deps;
    this.run(async () => {
      await client.renameSession(id, name);
      state.sessions = await client.listSessions(state.project.id);
      this.toast('ok', 'Session renamed');
    });
  }

  private deleteSession(id: string): void {
    const state = this.state;
    const { client } = this.deps;
    this.run(async () => {
      await client.deleteSession(id);
      state.sessions = await client.listSessions(state.project.id);
      if (state.settings.pinned.includes(id)) {
        await this.patchSettings({ pinned: state.settings.pinned.filter((p) => p !== id) });
      }
      this.toast('ok', 'Session deleted');
    });
  }

  private openIngest(): void {
    const state = this.state;
    const overlay: IngestOverlay = {
      type: 'ingest',
      index: 0,
      naming: null,
      confirmDelete: null,
      events: [],
      eventsFor: null,
    };
    state.overlay = overlay;
    state.input.clear();
    this.run(async () => {
      state.endpoints = await this.deps.client.listEndpoints(state.project.id);
      this.followEndpoint(overlay);
    });
  }

  /** Loads the selected endpoint's last events and keeps them live while it is open. */
  private followEndpoint(overlay: IngestOverlay): void {
    const state = this.state;
    const endpoint = state.endpoints[overlay.index];
    if (endpoint === undefined || overlay.eventsFor === endpoint.name) return;
    this.endpointStream?.abort();
    const controller = new AbortController();
    this.endpointStream = controller;
    overlay.eventsFor = endpoint.name;
    overlay.events = [];
    const { client } = this.deps;
    const projectId = state.project.id;
    const follow = async (): Promise<void> => {
      const stream =
        endpoint.state === 'open'
          ? client.endpointStream(projectId, endpoint.name, controller.signal)
          : null;
      const first = stream?.next();
      const events = await client.endpointEvents(projectId, endpoint.name, ENDPOINT_BACKLOG);
      if (controller.signal.aborted) return;
      overlay.events = events;
      this.deps.requestRender();
      if (stream === null || first === undefined) return;
      let next = await first;
      while (!next.done) {
        const event = parseEvent(next.value.data);
        if (event !== undefined && !overlay.events.some((e) => e.id === event.id)) {
          overlay.events.push(event);
          this.deps.requestRender();
        }
        next = await stream.next();
      }
    };
    follow().catch(() => undefined);
  }

  private async reloadEndpoints(overlay: IngestOverlay): Promise<void> {
    const state = this.state;
    state.endpoints = await this.deps.client.listEndpoints(state.project.id);
    overlay.index = Math.min(overlay.index, Math.max(0, state.endpoints.length - 1));
    overlay.eventsFor = null;
    this.followEndpoint(overlay);
  }

  private ingestKey(overlay: IngestOverlay, data: string): void {
    const state = this.state;
    if (overlay.naming !== null) {
      this.nameEndpointKey(overlay, data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      overlay.index = Math.max(0, Math.min(state.endpoints.length - 1, overlay.index + delta));
      overlay.confirmDelete = null;
      this.followEndpoint(overlay);
      return;
    }
    if (matchesKey(data, Key.ctrl('n'))) {
      overlay.naming = 'new';
      state.input.clear();
      return;
    }
    const endpoint = state.endpoints[overlay.index];
    if (endpoint === undefined) return;
    const { client } = this.deps;
    const projectId = state.project.id;
    const linked = linkedEndpoint(state) === endpoint.name;
    const busy = `The recording session is linked to ${endpoint.name}. Stop it first`;
    if (matchesKey(data, Key.enter)) {
      this.run(async () => {
        const ok = await this.deps.copy(endpointInstructions(endpoint));
        this.toast(
          ok ? 'ok' : 'err',
          ok ? `URL of ${endpoint.name} copied, with a curl example` : 'Clipboard not available',
        );
      });
    } else if (matchesKey(data, Key.space)) {
      if (linked) {
        this.toast('warn', busy);
        return;
      }
      this.run(async () => {
        if (endpoint.state === 'open') {
          await client.downEndpoint(projectId, endpoint.name);
          this.toast('ok', `${endpoint.name} closed. The URL stays reserved`);
        } else {
          await client.upEndpoint(projectId, endpoint.name);
          this.toast('ok', `${endpoint.name} open again, same URL`);
        }
        await this.reloadEndpoints(overlay);
      });
    } else if (matchesKey(data, Key.ctrl('r'))) {
      if (linked) {
        this.toast('warn', busy);
        return;
      }
      overlay.naming = endpoint.name;
      state.input.set(endpoint.name);
    } else if (matchesKey(data, Key.ctrl('d'))) {
      if (linked) {
        this.toast('warn', busy);
      } else if (overlay.confirmDelete !== endpoint.name) {
        overlay.confirmDelete = endpoint.name;
        this.toast(
          'err',
          `Press Ctrl+D again to delete ${endpoint.name}. Its URL stops working for good`,
        );
      } else {
        overlay.confirmDelete = null;
        this.run(async () => {
          await client.removeEndpoint(projectId, endpoint.name);
          overlay.index = Math.max(0, overlay.index - 1);
          await this.reloadEndpoints(overlay);
          this.toast('ok', 'Endpoint deleted');
        });
      }
    }
  }

  private nameEndpointKey(overlay: IngestOverlay, data: string): void {
    const state = this.state;
    const naming = overlay.naming;
    if (naming === null) return;
    if (matchesKey(data, Key.escape)) {
      overlay.naming = null;
      state.input.clear();
      return;
    }
    if (!matchesKey(data, Key.enter)) {
      state.input.handle(data);
      return;
    }
    const name = state.input.value.trim().toLowerCase();
    if (!isEndpointName(name)) {
      this.toast('warn', 'Use lowercase letters, digits and dashes');
      return;
    }
    overlay.naming = null;
    state.input.clear();
    const { client } = this.deps;
    const projectId = state.project.id;
    this.run(async () => {
      if (naming === 'new') {
        await client.upEndpoint(projectId, name);
        state.endpoints = await client.listEndpoints(projectId);
        overlay.index = Math.max(
          0,
          state.endpoints.findIndex((ep) => ep.name === name),
        );
        overlay.eventsFor = null;
        this.followEndpoint(overlay);
        this.toast('ok', `Endpoint ${name} open. Enter copies its URL`);
      } else {
        await client.renameEndpoint(projectId, naming, name);
        await this.reloadEndpoints(overlay);
        this.toast('ok', 'Renamed. The URL did not change');
      }
    });
  }

  private openPicker(picker: Omit<PickerOverlay, 'type' | 'index'>): void {
    const current = picker.items.findIndex((item) => item.current === true);
    const first = picker.items.findIndex((item) => item.heading !== true);
    const index = current >= 0 ? current : Math.max(0, first);
    this.state.overlay = { type: 'picker', index, ...picker };
    this.state.input.clear();
  }

  private pickerKey(overlay: PickerOverlay, data: string): void {
    const state = this.state;
    const items = filteredItems(overlay, state.input.value);
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      overlay.back?.();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      overlay.index = nextSelectable(items, overlay.index, delta);
      return;
    }
    const item = items[overlay.index];
    if (overlay.multi && matchesKey(data, Key.space)) {
      if (item !== undefined) overlay.onToggle?.(item);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (!overlay.multi && (item === undefined || item.heading === true)) return;
      if (!overlay.multi && item?.disabled !== undefined) {
        this.toast('warn', item.disabled);
        return;
      }
      this.closeOverlay();
      overlay.onPick(item ?? { id: '', label: '' });
      overlay.back?.();
      return;
    }
    if (overlay.filter && state.input.handle(data)) {
      const next = filteredItems(overlay, state.input.value);
      overlay.index = Math.max(
        0,
        next.findIndex((i) => i.heading !== true),
      );
    }
  }

  private pickProfile(confirm?: NewOverlay): void {
    const state = this.state;
    const current = confirm?.setup.profile ?? state.settings.lastSetup.profile;
    const items = state.profiles.map((profile) => {
      const item: PickerItem = {
        id: profile.slug,
        label: profile.label,
        detail: `${profile.detail}  @${profile.slug}`,
        current: profile.slug === current,
      };
      if (profile.blockedReason !== null) item.disabled = profile.blockedReason;
      return item;
    });
    const back =
      confirm === undefined
        ? undefined
        : (): void => {
            this.state.overlay = confirm;
            this.syncNewInput(confirm);
          };
    this.openPicker({
      title: 'Browser profile',
      filter: true,
      multi: false,
      items,
      back,
      onPick: (item) => {
        if (confirm !== undefined) {
          confirm.setup.profile = item.id;
          return;
        }
        this.run(async () => {
          await this.patchSettings({ lastSetup: { profile: item.id } });
          this.toast('ok', `Default profile: ${item.label}`);
        });
      },
    });
  }

  private pickRecord(): void {
    const record = this.state.settings.lastSetup.record;
    this.openPicker({
      title: 'Record by default',
      filter: false,
      multi: true,
      items: RECORD_KEYS.map((key) => ({
        id: key,
        label: key,
        checked: record[key],
        detail: RECORD_DETAIL[key],
      })),
      onToggle: (item) => {
        const key = RECORD_KEYS.find((k) => k === item.id);
        if (key === undefined) return;
        item.checked = item.checked !== true;
        const value = item.checked;
        this.run(async () => {
          await this.patchSettings({ lastSetup: { record: { [key]: value } } });
        });
      },
      onPick: () => {
        const now = this.state.settings.lastSetup.record;
        const list = RECORD_KEYS.filter((key) => now[key]).join(', ') || 'nothing';
        this.toast('ok', `Records by default: ${list}`);
      },
    });
  }

  private pickCopy(): void {
    const state = this.state;
    const target = state.screen === 'live' ? state.live?.session : state.summary?.detail;
    if (target === undefined) return;
    const items: PickerItem[] = [
      {
        id: 'agent',
        label: 'Agent prompt',
        detail: 'summary, bugs, file paths and commands to read more',
      },
      { id: 'bugs', label: 'Bugs and errors', detail: 'each bug with the events just before it' },
      { id: 'full', label: 'Full context', detail: 'the whole context file' },
    ];
    const endpoint = target.endpoint;
    if (endpoint !== null) {
      items.push({
        id: 'ingest',
        label: 'Ingest endpoint',
        detail: `URL, payload fields and curl for ${endpoint.name}`,
      });
    }
    const { client } = this.deps;
    this.openPicker({
      title: 'Copy',
      filter: false,
      multi: false,
      items,
      onPick: (item) => {
        this.run(async () => {
          let text: string;
          if (item.id === 'ingest' && endpoint !== null) text = endpointInstructions(endpoint);
          else if (item.id === 'bugs') text = (await client.prompt(target.id, 'bugs')).text;
          else if (item.id === 'full') text = (await client.prompt(target.id, 'full')).text;
          else text = (await client.prompt(target.id, 'agent')).text;
          const ok = await this.deps.copy(text);
          this.toast(ok ? 'ok' : 'err', ok ? `${item.label} copied` : 'Clipboard not available');
        });
      },
    });
  }

  private settingsKey(overlay: SettingsOverlay, data: string): void {
    const items = settingsItems(this.state);
    if (matchesKey(data, Key.escape)) {
      this.closeOverlay();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
      const delta = matchesKey(data, Key.down) ? 1 : -1;
      overlay.index = nextSelectable(items, overlay.index, delta);
      return;
    }
    if (!matchesKey(data, Key.space) && !matchesKey(data, Key.enter)) return;
    const item = items[overlay.index];
    if (item === undefined || item.heading === true) return;
    if (item.id === 'profile') {
      this.pickProfile();
      return;
    }
    const [group, key] = item.id.split(':');
    const value = item.checked !== true;
    if (group === 'record' && (key === 'actions' || key === 'network' || key === 'console')) {
      this.run(async () => {
        await this.patchSettings({ lastSetup: { record: { [key]: value } } });
      });
    }
    const shown = key === 'action' || key === 'network' || key === 'console' || key === 'ingest';
    if (group === 'show' && shown) {
      this.run(async () => {
        await this.patchSettings({ visibility: { [key]: value } });
      });
    }
  }
}
