import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { isSensitiveKey, redactText, redactUrl, redactValue } from './redaction.ts';

test('isSensitiveKey covers password-like keys and the extra auth names', () => {
  for (const key of [
    'password',
    'new_password',
    'userPassword',
    'passwd',
    'passphrase',
    'passcode',
    'pass',
    'pwd',
    'token',
    'TOKEN',
    'secret',
    'authorization',
    'Authorization',
    'cookie',
    'api_key',
    'apiKey',
    'API-KEY',
  ]) {
    equal(isSensitiveKey(key), true, key);
  }
  equal(isSensitiveKey('passport'), false);
  equal(isSensitiveKey('email'), false);
});

test('redactValue walks nested objects and arrays', () => {
  deepEqual(
    redactValue({
      email: 'user@example.test',
      password: 'hidden',
      nested: { apiKey: 'k', items: [{ token: 't' }, 'ok'] },
    }),
    {
      email: 'user@example.test',
      password: '<REDACTED>',
      nested: { apiKey: '<REDACTED>', items: [{ token: '<REDACTED>' }, 'ok'] },
    },
  );
  equal(redactValue('plain'), 'plain');
  equal(redactValue(4), 4);
});

test('redactUrl leaves bare URLs alone and redacts query values', () => {
  equal(redactUrl('http://app.test/login'), 'http://app.test/login');
  equal(
    redactUrl('http://app.test/login?user=ada&password=s3cret&token=abc'),
    'http://app.test/login?user=ada&password=<REDACTED>&token=<REDACTED>',
  );
  equal(redactUrl('http://app.test/x?pass=%E0%A4%A'), 'http://app.test/x?pass=<REDACTED>');
});

test('redactText handles JSON, form bodies, and malformed JSON', () => {
  equal(redactText('{"password":"x","n":1}'), '{"password":"<REDACTED>","n":1}');
  equal(redactText('email=a&pwd=b&ok=1'), 'email=a&pwd=<REDACTED>&ok=1');
  equal(redactText('{not json'), '{not json');
  equal(redactText(''), '');
});
