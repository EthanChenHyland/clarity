const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAIRealtimeSTT, DeepgramStreamingSTT } = require('../src/stt-streaming');

async function assertReconnectCancelled(StreamingClass) {
  const stt = new StreamingClass('test-key');
  stt._reconnectDelay = 5;
  let reconnects = 0;
  stt.connect = async () => { reconnects += 1; };

  stt._attemptReconnect();
  assert.ok(stt._reconnectTimer);
  stt.disconnect();
  assert.equal(stt._reconnectTimer, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(reconnects, 0);
}

test('OpenAI realtime does not reconnect after an intentional disconnect', async () => {
  await assertReconnectCancelled(OpenAIRealtimeSTT);
});

test('Deepgram does not reconnect after an intentional disconnect', async () => {
  await assertReconnectCancelled(DeepgramStreamingSTT);
});
