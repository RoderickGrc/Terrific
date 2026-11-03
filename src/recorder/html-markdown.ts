import { createRequire } from 'node:module';

type TurndownCtor = new (options?: {
  headingStyle?: 'atx' | 'setext';
}) => {
  turndown(html: string): string;
};

// turndown is CJS (export =); createRequire keeps verbatimModuleSyntax happy.
const TurndownService = createRequire(import.meta.url)('turndown') as TurndownCtor;

const STRIP = /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function htmlToMarkdown(html: string): { markdown: string; wordCount: number } {
  const markdown = new TurndownService({ headingStyle: 'atx' }).turndown(html.replace(STRIP, ''));
  const wordCount = markdown.split(/\s+/).filter((part) => part.length > 0).length;
  return { markdown, wordCount };
}
