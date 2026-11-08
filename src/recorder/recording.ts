import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { EventInput } from '../core/events.ts';
import type { RandomSource } from '../core/ids.ts';
import { randomId } from '../core/ids.ts';
import type { RecordOptions } from '../core/setup.ts';
import { parseActionPayload } from './action-payload.ts';
import {
  type ComposerDraft,
  type ComposerSegment,
  handleComposerRequest,
} from './composer-bridge.ts';
import { COMPOSER_BINDING, composerScriptSource } from './composer-script.ts';
import { htmlToMarkdown } from './html-markdown.ts';
import { type LaunchedBrowser, type LaunchOptions, launchBrowser } from './launch.ts';
import { attachNetwork } from './network.ts';
import { BINDING_NAME, pageScriptSource } from './page-script.ts';

const PREVIEW_MAX_BYTES = 2_000_000;

export type RecordingOptions = {
  browser: LaunchOptions;
  url: string;
  record: RecordOptions;
  screenshotsDir: string;
  random: RandomSource;
  onEvent: (event: EventInput) => void;
  appendEvent?: (event: EventInput) => Promise<{ id: string }>;
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

function collapseExcerpt(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function pageViewport(page: Page): Promise<{ width: number; height: number }> {
  const size = page.viewportSize();
  if (size !== null) return size;
  const [width, height] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  return { width, height };
}

export async function startRecording(options: RecordingOptions): Promise<Recording> {
  const launched = await launchBrowser(options.browser);
  try {
    return await attachRecording(launched, options);
  } catch (error) {
    // Without this the browser window would outlive a session that failed to start.
    await launched.close();
    throw error;
  }
}

async function attachRecording(
  launched: LaunchedBrowser,
  options: RecordingOptions,
): Promise<Recording> {
  const { context } = launched;
  let current = launched.page;
  let composerDraft: ComposerDraft | null = null;
  let screenshotLabelCount = 0;
  let snapshotLabelCount = 0;
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

  async function emitComposer(event: EventInput): Promise<{ id: string | null }> {
    if (options.appendEvent !== undefined) {
      return options.appendEvent(event);
    }
    options.onEvent(event);
    return { id: null };
  }

  async function takeScreenshot(page: Page): Promise<{
    file: string;
    absolute: string;
    bytes: number;
    buffer: Buffer;
  }> {
    await mkdir(options.screenshotsDir, { recursive: true });
    const id = randomId(10, options.random);
    const name = `ss_${id}.png`;
    const absolute = join(options.screenshotsDir, name);
    const buffer = await page.screenshot({ path: absolute, type: 'png' });
    const bytes = buffer.length > 0 ? buffer.length : (await stat(absolute)).size;
    return { file: `screenshots/${name}`, absolute, bytes, buffer };
  }

  async function screenshotPreview(file: string): Promise<string | null> {
    const absolute = join(options.screenshotsDir, basename(file));
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > PREVIEW_MAX_BYTES) return null;
      const buffer = await readFile(absolute);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async function draftWithPreviews(
    draft: ComposerDraft,
  ): Promise<ComposerDraft & { segments: (ComposerSegment & { preview?: string | null })[] }> {
    const segments = await Promise.all(
      draft.segments.map(async (segment) => {
        if (segment.type !== 'screenshot') return segment;
        return { ...segment, preview: await screenshotPreview(segment.file) };
      }),
    );
    return { ...draft, segments };
  }

  async function takeSnapshot(page: Page): Promise<{
    event: Extract<EventInput, { kind: 'snapshot' }>;
    excerpt: string;
  }> {
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
    const event: Extract<EventInput, { kind: 'snapshot' }> = {
      kind: 'snapshot',
      url,
      title,
      wordCount: converted.wordCount,
      markdown: converted.markdown,
    };
    return { event, excerpt: collapseExcerpt(converted.markdown) };
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
    try {
      await page.evaluate(composerScriptSource(COMPOSER_BINDING));
    } catch {
      // The document may already be navigating; addInitScript covers the next load.
    }
  }

  if (options.record.actions) {
    await context.exposeBinding(BINDING_NAME, (source, payload: unknown) => {
      setCurrent(source.page);
      const event = parseActionPayload(payload);
      if (event !== null) options.onEvent(event);
    });
  }
  await context.exposeBinding(COMPOSER_BINDING, async (source, op: unknown, payload?: unknown) => {
    setCurrent(source.page);
    return handleComposerRequest(op, payload, {
      screenshot: async () => {
        const captured = await takeScreenshot(source.page);
        await emitComposer({
          kind: 'screenshot',
          file: captured.file,
          bytes: captured.bytes,
        });
        const viewport = await pageViewport(source.page);
        const preview =
          captured.bytes > PREVIEW_MAX_BYTES
            ? null
            : `data:image/png;base64,${captured.buffer.toString('base64')}`;
        screenshotLabelCount += 1;
        return {
          file: captured.file,
          width: viewport.width,
          height: viewport.height,
          preview,
          label: `Screenshot ${screenshotLabelCount}`,
        };
      },
      snapshot: async () => {
        const { event, excerpt } = await takeSnapshot(source.page);
        const { id } = await emitComposer(event);
        snapshotLabelCount += 1;
        return {
          id,
          title: event.title,
          wordCount: event.wordCount,
          excerpt,
          label: `Snapshot ${snapshotLabelCount}`,
        };
      },
      submit: async (kind, text) => {
        if (kind === 'note') {
          if (text === null) throw new Error('Note text is required.');
          return emitComposer({ kind: 'note', text, author: 'tester' });
        }
        return emitComposer({ kind: 'bug', text, author: 'tester' });
      },
      loadDraft: async () => {
        if (composerDraft === null) return { draft: null };
        return { draft: await draftWithPreviews(composerDraft) };
      },
      saveDraft: async (draft) => {
        composerDraft = draft;
      },
    });
  });
  if (options.record.actions) {
    await context.addInitScript({ content: pageScriptSource(BINDING_NAME) });
  }
  await context.addInitScript({ content: composerScriptSource(COMPOSER_BINDING) });
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
    try {
      await currentPage().goto(options.url, { waitUntil: 'domcontentloaded' });
    } catch {
      // An unreachable URL (dev server not up yet, a typo) must not abort the session: the
      // browser shows its error page, the failed request is recorded, and the tester retries.
    }
  }

  return {
    get page() {
      return currentPage();
    },
    context,
    async snapshot() {
      const { event } = await takeSnapshot(currentPage());
      options.onEvent(event);
      return event;
    },
    async screenshot() {
      const captured = await takeScreenshot(currentPage());
      options.onEvent({ kind: 'screenshot', file: captured.file, bytes: captured.bytes });
      return captured.absolute;
    },
    async stop() {
      finish('stopped');
      await launched.close();
    },
    closed,
  };
}
