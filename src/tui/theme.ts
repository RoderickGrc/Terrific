import {
  backgroundAnsi,
  type Color,
  getTerminalColorMode,
  parseColor,
  styleText,
  type TerminalColorMode,
} from '@earendil-works/pi-tui';
import type { EventLineTag } from '../core/event-line.ts';

// Interface greys and accents follow anygent's terminal renderer; event colors are terrific web's
// Tailwind v3 values so a type looks the same in both tools.
const PALETTE = {
  fg1: '#f0f0f0',
  fg2: '#8a8a8a',
  fg3: '#555555',
  info: '#3d9edc',
  ok: '#6c63ff',
  warn: '#e8a83d',
  err: '#dc3d3d',
  accent: '#8b85ff',
  net: '#34d399',
  log: '#60a5fa',
  act: '#a1a1aa',
  nav: '#a78bfa',
  capture: '#22d3ee',
  ingest: '#fb923c',
  failure: '#f87171',
  bug: '#ef4444',
  flag: '#f59e0b',
  note: '#818cf8',
} as const;

const FILLS = {
  prompt: '#1c1c1c',
  editor: '#242424',
  stats: '#141414',
  pick: '#2c2a46',
} as const;

export type Tone = keyof typeof PALETTE;
export type Fill = keyof typeof FILLS;

export type Style = {
  tone?: Tone;
  bold?: boolean;
  underline?: boolean;
};

export type Theme = {
  paint(text: string, style: Tone | Style): string;
  fill(line: string, fill: Fill): string;
  /** Background on a span inside a line; the line's own fill comes back after it. */
  highlight(text: string, fill: Fill): string;
  caret(text: string): string;
};

function compile<T extends Record<string, string>>(table: T): Record<keyof T, Color> {
  const out = {} as Record<keyof T, Color>;
  for (const key of Object.keys(table) as (keyof T)[]) out[key] = parseColor(table[key] as string);
  return out;
}

export function createTheme(options: { color: boolean; mode?: TerminalColorMode }): Theme {
  const colors = compile(PALETTE);
  const fills = compile(FILLS);
  const mode = options.mode ?? getTerminalColorMode();
  if (!options.color) {
    return {
      paint: (text, style) =>
        typeof style !== 'string' && style.bold === true ? `\x1b[1m${text}\x1b[22m` : text,
      fill: (line) => line,
      highlight: (text) => text,
      caret: (text) => `\x1b[7m${text}\x1b[27m`,
    };
  }
  return {
    paint(text, style) {
      if (text === '') return '';
      const s = typeof style === 'string' ? { tone: style } : style;
      return styleText(
        text,
        {
          fg: s.tone === undefined ? undefined : colors[s.tone],
          bold: s.bold,
          underline: s.underline,
        },
        mode,
      );
    },
    fill(line, fill) {
      // Truncation and nested styles may reset everything; the background is applied again after each reset.
      const bg = backgroundAnsi(fills[fill], mode);
      return `${bg}${line.replaceAll('\x1b[0m', `\x1b[0m${bg}`).replaceAll('\x1b[49m', bg)}\x1b[49m`;
    },
    highlight: (text, fill) => styleText(text, { bg: fills[fill] }, mode),
    caret: (text) => styleText(text, { fg: parseColor('#0c0c0c'), bg: colors.accent }, mode),
  };
}

export const TAG_TONE: Record<EventLineTag, Tone> = {
  net: 'net',
  log: 'log',
  act: 'act',
  nav: 'nav',
  shot: 'capture',
  snap: 'capture',
  ingest: 'ingest',
  note: 'note',
  bug: 'bug',
  flag: 'flag',
  life: 'fg3',
};

/** NO_COLOR (https://no-color.org) turns colors off; bold and the caret stay. */
export function colorEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.NO_COLOR;
  return value === undefined || value === '';
}
