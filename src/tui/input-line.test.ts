import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { InputLine } from './input-line.ts';

function typed(text: string): InputLine {
  const input = new InputLine();
  for (const ch of text) input.handle(ch);
  return input;
}

test('typing inserts at the caret and arrows move it', () => {
  const input = typed('helo');
  input.handle('\x1b[D');
  input.handle('l');
  equal(input.value, 'hello');
  equal(input.caret, 4);
});

test('backspace, Ctrl+W and Ctrl+U delete backwards', () => {
  const input = typed('one two three');
  input.handle('\x7f');
  equal(input.value, 'one two thre');
  input.handle('\x17');
  equal(input.value, 'one two ');
  input.handle('\x15');
  equal(input.value, '');
});

test('a selected value is replaced by the next typed text', () => {
  const input = new InputLine();
  input.set('old name', { selected: true });
  input.handle('n');
  equal(input.value, 'n');
  equal(input.selected, false);
});

test('a bracketed paste arrives as one line, even split across chunks', () => {
  const input = new InputLine();
  input.handle('\x1b[200~first\nsec');
  input.handle('ond\x1b[201~');
  equal(input.value, 'first second');
});

test('control keys that are not editing keys are not consumed', () => {
  const input = new InputLine();
  equal(input.handle('\r'), false);
  equal(input.handle('\x1b[A'), false);
  equal(input.value, '');
});
