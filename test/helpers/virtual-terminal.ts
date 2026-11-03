import type { Terminal } from '@earendil-works/pi-tui';
import xterm from '@xterm/headless';

/** A pi-tui terminal backed by a headless xterm, so tests read the screen a user would see. */
export class VirtualTerminal implements Terminal {
  private readonly screen: InstanceType<typeof xterm.Terminal>;
  private onInput: ((data: string) => void) | undefined;
  private onResize: (() => void) | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(columns: number, rows: number) {
    this.screen = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }

  stop(): void {
    this.onInput = undefined;
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.pending = this.pending.then(
      () => new Promise<void>((resolve) => this.screen.write(data, resolve)),
    );
  }

  get columns(): number {
    return this.screen.cols;
  }

  get rows(): number {
    return this.screen.rows;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\x1b[${lines}B`);
    if (lines < 0) this.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void {
    this.write('\x1b[?25l');
  }

  showCursor(): void {
    this.write('\x1b[?25h');
  }

  clearLine(): void {
    this.write('\x1b[K');
  }

  clearFromCursor(): void {
    this.write('\x1b[J');
  }

  clearScreen(): void {
    this.write('\x1b[2J\x1b[H');
  }

  setTitle(): void {}

  setProgress(): void {}

  setProgramStatus(): void {}

  /** Types keys as the terminal would deliver them. */
  send(data: string): void {
    this.onInput?.(data);
  }

  resize(columns: number, rows: number): void {
    this.screen.resize(columns, rows);
    this.onResize?.();
  }

  /** Waits for scheduled renders and pending writes, then returns the visible rows. */
  async lines(): Promise<string[]> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await this.pending;
    const buffer = this.screen.buffer.active;
    const out: string[] = [];
    for (let i = 0; i < this.screen.rows; i += 1) {
      out.push(buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? '');
    }
    return out;
  }

  async text(): Promise<string> {
    return (await this.lines()).join('\n');
  }
}
