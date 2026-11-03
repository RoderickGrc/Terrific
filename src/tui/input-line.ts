import { decodeKittyPrintable, Key, matchesKey } from '@earendil-works/pi-tui';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

function printable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control input is the point.
  return data.length > 0 && !/[\x00-\x1f\x7f]/.test(data) ? data : undefined;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && !/\s/.test(ch);
}

/**
 * A single-line text field with a caret. The TUI owns rendering; this only edits the value
 * and reports whether a key changed it.
 */
export class InputLine {
  value = '';
  caret = 0;
  /** Whole value selected: the next typed text replaces it (the stop confirmation's name). */
  selected = false;
  private pasting: string | null = null;

  set(value: string, options: { selected?: boolean } = {}): void {
    this.value = value;
    this.caret = value.length;
    this.selected = options.selected === true && value !== '';
  }

  clear(): void {
    this.set('');
  }

  /** Returns true when the key was an editing key, whether or not the value changed. */
  handle(data: string): boolean {
    if (this.pasting !== null || data.startsWith(PASTE_START)) return this.paste(data);
    if (matchesKey(data, Key.left)) return this.move(this.caret - 1);
    if (matchesKey(data, Key.right)) return this.move(this.caret + 1);
    if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl('a'))) return this.move(0);
    if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl('e'))) {
      return this.move(this.value.length);
    }
    if (matchesKey(data, Key.ctrl('left')) || matchesKey(data, Key.alt('left'))) {
      return this.move(this.wordStart());
    }
    if (matchesKey(data, Key.ctrl('right')) || matchesKey(data, Key.alt('right'))) {
      return this.move(this.wordEnd());
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.selected) return this.replaceAll('');
      return this.cut(this.caret - 1, this.caret);
    }
    if (matchesKey(data, Key.delete)) {
      if (this.selected) return this.replaceAll('');
      return this.cut(this.caret, this.caret + 1);
    }
    if (matchesKey(data, Key.ctrl('w')) || matchesKey(data, Key.ctrl('backspace'))) {
      return this.cut(this.wordStart(), this.caret);
    }
    if (matchesKey(data, Key.ctrl('u'))) return this.cut(0, this.caret);
    if (matchesKey(data, Key.ctrl('k'))) return this.cut(this.caret, this.value.length);
    const text = printable(data);
    if (text === undefined) return false;
    this.insert(text);
    return true;
  }

  insert(text: string): void {
    const clean = text.replace(/[\r\n\t]+/g, ' ');
    if (this.selected) {
      this.value = '';
      this.caret = 0;
      this.selected = false;
    }
    this.value = this.value.slice(0, this.caret) + clean + this.value.slice(this.caret);
    this.caret += clean.length;
  }

  private paste(data: string): boolean {
    let chunk = data;
    if (this.pasting === null) {
      this.pasting = '';
      chunk = chunk.slice(PASTE_START.length);
    }
    const end = chunk.indexOf(PASTE_END);
    if (end < 0) {
      this.pasting += chunk;
      return true;
    }
    const text = this.pasting + chunk.slice(0, end);
    this.pasting = null;
    this.insert(text.trim());
    return true;
  }

  private move(to: number): boolean {
    this.selected = false;
    this.caret = Math.max(0, Math.min(this.value.length, to));
    return true;
  }

  private replaceAll(value: string): boolean {
    this.set(value);
    return true;
  }

  private cut(from: number, to: number): boolean {
    this.selected = false;
    const start = Math.max(0, from);
    const end = Math.min(this.value.length, to);
    if (start >= end) return true;
    this.value = this.value.slice(0, start) + this.value.slice(end);
    this.caret = start;
    return true;
  }

  private wordStart(): number {
    let i = this.caret;
    while (i > 0 && !isWordChar(this.value[i - 1])) i -= 1;
    while (i > 0 && isWordChar(this.value[i - 1])) i -= 1;
    return i;
  }

  private wordEnd(): number {
    let i = this.caret;
    while (i < this.value.length && !isWordChar(this.value[i])) i += 1;
    while (i < this.value.length && isWordChar(this.value[i])) i += 1;
    return i;
  }
}
