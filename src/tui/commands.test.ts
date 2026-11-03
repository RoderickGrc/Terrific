import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { availableCommands, findCommand, paletteMatches, splitCommand } from './commands.ts';

const names = (list: { name: string }[]): string[] => list.map((c) => c.name);

test('commands only appear where they work', () => {
  const home = availableCommands({ screen: 'home', browser: false, background: false });
  equal(names(home).includes('stop'), false);
  equal(names(home).includes('attach'), false);
  const noBrowser = availableCommands({ screen: 'live', browser: false, background: false });
  equal(names(noBrowser).includes('screenshot'), false);
  const browser = availableCommands({ screen: 'live', browser: true, background: false });
  equal(names(browser).includes('screenshot'), true);
});

test('the palette matches names and aliases until arguments start', () => {
  const list = availableCommands({ screen: 'home', browser: false, background: false });
  deepEqual(names(paletteMatches('/res', list)), ['sessions']);
  deepEqual(paletteMatches('/new x', list), []);
  equal(findCommand('RESUME', list)?.name, 'sessions');
  deepEqual(splitCommand('/name  checkout v2 '), { word: 'name', args: 'checkout v2' });
});

test('/model and /profile open the profiles panel, for people used to chat commands', () => {
  const list = availableCommands({ screen: 'home', browser: false, background: false });
  equal(findCommand('model', list)?.name, 'profiles');
  equal(findCommand('profile', list)?.name, 'profiles');
  deepEqual(names(paletteMatches('/mod', list)), ['profiles']);
});
