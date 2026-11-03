import type { IncomingMessage, ServerResponse } from 'node:http';

export type SseWriter = {
  send(event: string, data: unknown): void;
  close(): void;
  onClose(fn: () => void): void;
};

export function openSse(req: IncomingMessage, res: ServerResponse, pingMs = 15_000): SseWriter {
  const closers: (() => void)[] = [];
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const timer = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, pingMs);
  timer.unref();
  const close = (): void => {
    clearInterval(timer);
    for (const fn of closers) fn();
    closers.length = 0;
    if (!res.writableEnded) res.end();
  };
  req.on('close', close);
  return {
    send(event, data) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
    onClose(fn) {
      closers.push(fn);
    },
  };
}
