import { equal, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { findInstalledBrowsers } from '../src/recorder/browsers.ts';
import { captureState, hasState, launchBrowser } from '../src/recorder/launch.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const browser = findInstalledBrowsers({
  platform: process.platform,
  env: process.env,
  exists: existsSync,
})[0];

test('a snapshot launch restores the cookies and localStorage captured before', {
  skip: browser === undefined ? 'no supported browser installed' : false,
}, async () => {
  if (browser === undefined) return;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=abc; Path=/' });
    res.end('<html><body>ok</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const url = `http://127.0.0.1:${address.port}/`;
  const dir = await mkdtemp(join(tmpdir(), 'terrific-profile-launch-'));
  dirs.push(dir);
  const stateFile = join(dir, 'state.json');
  const options = {
    executablePath: browser.executablePath,
    userDataDir: null,
    headless: true,
    storageState: stateFile,
  };
  try {
    const first = await launchBrowser(options);
    await first.page.goto(url);
    await first.page.evaluate(() => localStorage.setItem('flag', 'on'));
    const state = await captureState(first.context);
    await first.close();
    ok(hasState(state));
    await writeFile(stateFile, state);

    const second = await launchBrowser(options);
    await second.page.goto(url);
    equal(await second.page.evaluate(() => localStorage.getItem('flag')), 'on');
    const cookies = await second.context.cookies();
    equal(cookies.find((cookie) => cookie.name === 'sid')?.value, 'abc');
    await second.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
