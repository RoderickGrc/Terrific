import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Fill, Theme } from './theme.ts';

export type Line = {
  left: string;
  right?: string;
  fill?: Fill;
};

export function line(left: string, right = '', fill?: Fill): Line {
  return fill === undefined ? { left, right } : { left, right, fill };
}

export function blank(fill?: Fill): Line {
  return line('', '', fill);
}

/** Left text truncated with an ellipsis so the right part always fits, padded to the full width. */
export function renderLine(theme: Theme, item: Line, width: number): string {
  const right = item.right ?? '';
  const rightWidth = Math.min(visibleWidth(right), width);
  const room = Math.max(0, width - rightWidth);
  const left = truncateToWidth(item.left, room, '…');
  const gap = Math.max(0, room - visibleWidth(left));
  const text = `${left}${' '.repeat(gap)}${rightWidth > 0 ? truncateToWidth(right, rightWidth) : ''}`;
  return item.fill === undefined ? text : theme.fill(text, item.fill);
}

export function padEndVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/** Shortens a path in the middle so its last folder stays readable. */
export function trimPathMiddle(path: string, max: number): string {
  if (path.length <= max) return path;
  const cut = Math.max(
    path.lastIndexOf('\\', path.length - 2),
    path.lastIndexOf('/', path.length - 2),
  );
  const tail = cut >= 0 ? path.slice(cut) : path.slice(-Math.floor(max / 2));
  const head = path.slice(0, Math.max(8, max - tail.length - 1));
  return `${head}…${tail}`;
}

/** Joins items with a separator, starting a new line before one would overflow the width. */
export function wrapItems(
  items: { text: string; styled: string }[],
  width: number,
  separator: { text: string; styled: string },
): string[] {
  const lines: string[] = [];
  let current = '';
  let used = 0;
  for (const item of items) {
    const extra = used === 0 ? 0 : separator.text.length;
    if (used > 0 && used + extra + item.text.length > width) {
      lines.push(current);
      current = '';
      used = 0;
    }
    current += (used === 0 ? '' : separator.styled) + item.styled;
    used += (used === 0 ? 0 : separator.text.length) + item.text.length;
  }
  if (current !== '') lines.push(current);
  return lines;
}
