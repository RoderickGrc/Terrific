export type SseMessage = {
  event: string;
  data: string;
};

const decoder = new TextDecoder();

function dispatch(event: string, dataLines: string[]): SseMessage | undefined {
  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join('\n') };
}

function applyLine(line: string, state: { event: string; data: string[] }): SseMessage | undefined {
  if (line === '') {
    const message = dispatch(state.event, state.data);
    state.event = 'message';
    state.data = [];
    return message;
  }
  if (line.startsWith(':')) return undefined;
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  if (field === 'event') state.event = value;
  if (field === 'data') state.data.push(value);
  return undefined;
}

// Hold a trailing CR so a chunk that ends at `\r` of `\r\n` does not become an extra line.
function takeLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (ch === '\n') {
      const end = i > start && buffer[i - 1] === '\r' ? i - 1 : i;
      lines.push(buffer.slice(start, end));
      start = i + 1;
      continue;
    }
    if (ch === '\r') {
      const next = buffer[i + 1];
      if (next === '\n') {
        lines.push(buffer.slice(start, i));
        start = i + 2;
        i += 1;
        continue;
      }
      if (next !== undefined) {
        lines.push(buffer.slice(start, i));
        start = i + 1;
      }
    }
  }
  return { lines, rest: buffer.slice(start) };
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const state = { event: 'message', data: [] as string[] };
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = takeLines(buffer);
      buffer = rest;
      for (const line of lines) {
        const message = applyLine(line, state);
        if (message !== undefined) yield message;
      }
    }
    buffer += decoder.decode();
    const last = takeLines(buffer.endsWith('\r') ? `${buffer}\n` : buffer);
    for (const line of last.lines) {
      const message = applyLine(line, state);
      if (message !== undefined) yield message;
    }
    if (last.rest !== '') {
      const message = applyLine(last.rest, state);
      if (message !== undefined) yield message;
    }
    const tail = dispatch(state.event, state.data);
    if (tail !== undefined) yield tail;
  } finally {
    reader.releaseLock();
  }
}
