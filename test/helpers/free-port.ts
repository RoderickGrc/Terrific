import { createServer } from 'node:net';

// Tests that spawn a daemon need a fixed port before it starts. Asking the OS for port 0
// returns one from the ephemeral range, which other tests running daemons on port 0 may
// receive next, so the port is drawn from a range the OS does not hand out by itself.
const LOW = 20_000;
const HIGH = 29_999;

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = LOW + Math.floor(Math.random() * (HIGH - LOW + 1));
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port found between ${LOW} and ${HIGH}.`);
}
