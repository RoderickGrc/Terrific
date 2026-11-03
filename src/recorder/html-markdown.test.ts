import { equal, match, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToMarkdown } from './html-markdown.ts';

test('htmlToMarkdown strips script and style and keeps the heading', () => {
  const converted = htmlToMarkdown(
    '<h1>Second page</h1><script>alert(1)</script><style>h1{color:red}</style><p>Hello world</p>',
  );
  match(converted.markdown, /Second page/);
  equal(converted.markdown.includes('alert(1)'), false);
  ok(converted.wordCount >= 3);
});
