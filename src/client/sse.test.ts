import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { parseSseStream } from './sse.ts';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out = [];
  for await (const message of parseSseStream(streamFromChunks(chunks))) {
    out.push(message);
  }
  return out;
}

test('parseSseStream joins chunked fields, ignores comments, and keeps multi-line data', async () => {
  const messages = await collect([
    'event: ing',
    'est\ndata: {"a":1}\n\n',
    ': ping\n\n',
    'data: line1\r\n',
    'data: line2\r\n\r\n',
    'event: done\ndata: end',
  ]);
  deepEqual(messages, [
    { event: 'ingest', data: '{"a":1}' },
    { event: 'message', data: 'line1\nline2' },
    { event: 'done', data: 'end' },
  ]);
});

test('parseSseStream treats a CR at a chunk boundary as part of CRLF', async () => {
  const messages = await collect(['event: x\r', '\ndata: y\r', '\n\r\n']);
  deepEqual(messages, [{ event: 'x', data: 'y' }]);
  equal(messages.length, 1);
});
