import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { EventInput } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import { randomId } from '../core/ids.ts';
import type { RecordOptions } from '../core/setup.ts';
import { parseActionPayload } from './action-payload.ts';
import { htmlToMarkdown } from './html-markdown.ts';
import { type LaunchOptions, launchBrowser } from './launch.ts';
import { attachNetwork } from './network.ts';
import { BINDING_NAME, pageScriptSource } from './page-script.ts';

export type RecordingOptions = {
  browser: LaunchOptions;
  url: string;
  record: RecordOptions;
  screenshotsDir: string;
  random: RandomSource;
  onEvent: (event: EventInput) => void;
};

export type Recording = {
  page: Page;
  context: BrowserContext;
  snapshot(): Promise<EventInput>;
  screenshot(): Promise<string>;
  stop(): Promise<void>;
  closed: Promise<'stopped' | 'browser-closed'>;
};

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

function mapConsoleLevel(type: string): ConsoleLevel {
  if (type === 'warning') return 'warn';
  if (type === 'log' || type === 'info' || type === 'debug' || type === 'error') return type;
  return 'log';
}

function isOpen(page: Page): boolean {
  return !page.isClosed();
}

export async function startRecording(options: RecordingOptions): Promise<Recording> {
  const launched = await launchBrowser(options.browser);
  const { context } = launched;
  let current = launched.page;
  let outcome: 'stopped' | 'browser-closed' | null = null;
  let resolveClosed: ((reason: 'stopped' | 'browser-closed') => void) | undefined;
  const closed = new Promise<'stopped' | 'browser-closed'>((resolve) => {
    resolveClosed = resolve;
  });

  function finish(reason: 'stopped' | 'browser-closed'): void {
    if (outcome !== null) return;
    outcome = reason;
    resolveClosed?.(reason);
  }

  function setCurrent(page: Page): void {
    if (isOpen(page)) current = page;
  }

  function currentPage(): Page {
    if (isOpen(current)) return current;
    const open = context.pages().find(isOpen);
    if (open !== undefined) current = open;
    return current;
  }

  async function attachPage(page: Page): Promise<void> {
    setCurrent(page);
    page.on('close', () => {
      if (current === page) {
        const open = context.pages().find(isOpen);
        if (open !== undefined) current = open;
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      setCurrent(page);
      void page
        .title()
        .catch(() => '')
        .then((title) => {
          options.onEvent({ kind: 'navigation', url: frame.url(), title });
        });
    });
    if (options.record.console) {
      page.on('pageerror', (error) => {
        setCurrent(page);
        options.onEvent({ kind: 'console', level: 'error', text: error.message });
      });
    }
    if (options.record.actions) {
      try {
        await page.evaluate(pageScriptSource(BINDING_NAME));
      } catch {
        // The document may already be navigating; addInitScript covers the next load.
      }
    }
  }

  if (options.record.actions) {
    await context.exposeBinding(BINDING_NAME, (source, payload: unknown) => {
      setCurrent(source.page);
      const event = parseActionPayload(payload);
      if (event !== null) options.onEvent(event);
    });
    await context.addInitScript({ content: pageScriptSource(BINDING_NAME) });
  }
  if (options.record.network) attachNetwork(context, options.onEvent);
  if (options.record.console) {
    context.on('console', (msg) => {
      const from = msg.page();
      if (from !== null) setCurrent(from);
      options.onEvent({
        kind: 'console',
        level: mapConsoleLevel(msg.type()),
        text: msg.text(),
      });
    });
  }

  context.on('page', (page) => {
    void attachPage(page);
  });
  for (const page of context.pages()) {
    await attachPage(page);
  }

  context.on('close', () => {
    finish('browser-closed');
    void launched.close();
  });

  if (options.url !== '') {
    await currentPage().goto(options.url, { waitUntil: 'domcontentloaded' });
  }

  return {
    get page() {
      return currentPage();
    },
    context,
    async snapshot() {
      const page = currentPage();
      let html = '';
      let title = '';
      let url = '';
      try {
        html = await page.content();
        title = await page.title();
        url = page.url();
      } catch {
        title = '';
      }
      const converted = htmlToMarkdown(html);
      const event: EventInput = {
        kind: 'snapshot',
        url,
        title,
        wordCount: converted.wordCount,
        markdown: converted.markdown,
      };
      options.onEvent(event);
      return event;
    },
    async screenshot() {
      await mkdir(options.screenshotsDir, { recursive: true });
      const id = randomId(10, options.random);
      const name = `ss_${id}.png`;
      const absolute = join(options.screenshotsDir, name);
      const page = currentPage();
      const buffer = await page.screenshot({ path: absolute, type: 'png' });
      const bytes = buffer.length > 0 ? buffer.length : (await stat(absolute)).size;
      options.onEvent({ kind: 'screenshot', file: `screenshots/${name}`, bytes });
      return absolute;
    },
    async stop() {
      finish('stopped');
      await launched.close();
    },
    closed,
  };
}
