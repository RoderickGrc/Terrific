import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { createStreamHub, endpointTopic, sessionTopic } from './stream-hub.ts';

test('subscribers receive only messages published after they subscribe', () => {
  const hub = createStreamHub();
  const topic = endpointTopic('projid01', 'app');
  const before: unknown[] = [];
  const after: unknown[] = [];
  hub.publish(topic, { n: 1 });
  const unsub = hub.subscribe(topic, (message) => {
    after.push(message);
  });
  hub.publish(topic, { n: 2 });
  hub.subscribe(sessionTopic('sessionid1'), (message) => {
    before.push(message);
  });
  hub.publish(topic, { n: 3 });
  deepEqual(after, [{ n: 2 }, { n: 3 }]);
  deepEqual(before, []);
  unsub();
  hub.publish(topic, { n: 4 });
  deepEqual(after, [{ n: 2 }, { n: 3 }]);
});

test('closeAll drops every subscriber', () => {
  const hub = createStreamHub();
  let count = 0;
  hub.subscribe('endpoint:a/b', () => {
    count += 1;
  });
  hub.closeAll();
  hub.publish('endpoint:a/b', { ok: true });
  equal(count, 0);
});
