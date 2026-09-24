const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamTokenBatcher } = require('../src/stream-token-batcher');

function fakeTimers() {
  let callback = null;
  return {
    setTimer(fn) { callback = fn; return 1; },
    clearTimer() { callback = null; },
    fire() { const fn = callback; callback = null; fn?.(); },
    pending() { return !!callback; },
  };
}

test('sends the first token immediately and batches follow-on token IPC', () => {
  const sent = [];
  const timers = fakeTimers();
  const batcher = createStreamTokenBatcher((text) => sent.push(text), {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  batcher.push('A');
  batcher.push('B');
  batcher.push('C');
  assert.deepEqual(sent, ['A']);
  assert.equal(timers.pending(), true);
  timers.fire();
  assert.deepEqual(sent, ['A', 'BC']);
});

test('flush sends pending text and cancel drops it', () => {
  const sent = [];
  const timers = fakeTimers();
  const batcher = createStreamTokenBatcher((text) => sent.push(text), {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  batcher.push('first');
  batcher.push(' second');
  batcher.flush();
  assert.deepEqual(sent, ['first', ' second']);
  assert.equal(timers.pending(), false);

  batcher.push(' dropped');
  batcher.cancel();
  timers.fire();
  assert.deepEqual(sent, ['first', ' second']);
});
