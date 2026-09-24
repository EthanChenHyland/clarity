const test = require('node:test');
const assert = require('node:assert/strict');
const { streamWithSmartFallback } = require('../src/live-answer-stream');

function fakeLLM(model, behavior) {
  return { ready: true, model, stream: behavior };
}

test('fast model wins without starting Smart when it produces a token quickly', async () => {
  let smartCalls = 0;
  const tokens = [];
  const fast = fakeLLM('fast-model', async ({ onToken }) => { onToken('fast'); return 'fast'; });
  const smart = fakeLLM('smart-model', async () => { smartCalls += 1; return 'smart'; });
  const answer = await streamWithSmartFallback({
    fast, smart, fallbackDelayMs: 20,
    streamOptions: { onToken: token => tokens.push(token) }
  });
  assert.equal(answer, 'fast');
  assert.deepEqual(tokens, ['fast']);
  assert.equal(smartCalls, 0);
});

test('Smart takes over when Fast has no first token before the fallback deadline', async () => {
  const tokens = [];
  let fastAborted = false;
  const fast = fakeLLM('fast-model', ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { fastAborted = true; reject(new Error('aborted')); }, { once: true });
  }));
  const smart = fakeLLM('smart-model', async ({ onToken }) => { onToken('smart'); return 'smart'; });
  const answer = await streamWithSmartFallback({
    fast, smart, fallbackDelayMs: 10,
    streamOptions: { onToken: token => tokens.push(token) }
  });
  assert.equal(answer, 'smart');
  assert.deepEqual(tokens, ['smart']);
  assert.equal(fastAborted, true);
});

test('a Fast failure starts Smart immediately', async () => {
  let smartCalls = 0;
  const fast = fakeLLM('fast-model', async () => { throw new Error('fast failed'); });
  const smart = fakeLLM('smart-model', async ({ onToken }) => { smartCalls += 1; onToken('ok'); return 'ok'; });
  const answer = await streamWithSmartFallback({ fast, smart, fallbackDelayMs: 5000, streamOptions: {} });
  assert.equal(answer, 'ok');
  assert.equal(smartCalls, 1);
});
