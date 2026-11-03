import { visibleWidth } from '@earendil-works/pi-tui';
import type { InputLine } from '../input-line.ts';
import type { TuiState } from '../state.ts';
import type { Theme, Tone } from '../theme.ts';

export type View = {
  theme: Theme;
  state: TuiState;
  width: number;
  height: number;
};

export function keyHint(theme: Theme, key: string, label: string): string {
  return `${theme.paint(key, 'fg2')} ${theme.paint(label, 'fg3')}`;
}

export function hints(theme: Theme, pairs: [string, string][]): string {
  return pairs.map(([key, label]) => keyHint(theme, key, label)).join('  ');
}

/** The input value with a block caret, scrolled so the caret stays inside `room` columns. */
export function inputText(theme: Theme, input: InputLine, room: number): string {
  const value = input.value;
  if (input.selected) return theme.caret(value);
  const width = Math.max(1, room - 1);
  const start = input.caret > width ? input.caret - width : 0;
  const shown = value.slice(start, start + width + 1);
  const at = input.caret - start;
  const under = shown[at] ?? ' ';
  return `${shown.slice(0, at)}${theme.caret(under)}${shown.slice(at + 1)}`;
}

export function placeholderText(theme: Theme, text: string): string {
  return `${theme.caret(' ')}${theme.paint(text, 'fg3')}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function sep(theme: Theme): string {
  return theme.paint('  ·  ', 'fg3');
}

export function painted(theme: Theme, text: string, tone: Tone, bold = false): string {
  return theme.paint(text, { tone, bold });
}

export function fits(text: string, width: number): boolean {
  return visibleWidth(text) <= width;
}
