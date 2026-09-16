const assert = require('node:assert/strict');
const test = require('node:test');
const { downmixToMono } = require('../renderer/audio-worklet-processor');

test('downmixes every loopback channel instead of discarding non-left-channel speech', () => {
  const left = Float32Array.from([0.2, 0, -0.4]);
  const right = Float32Array.from([0.6, 0.8, 0.2]);
  const mono = downmixToMono([left, right]);
  assert.deepEqual(Array.from(mono), [
    Math.fround(0.4),
    Math.fround(0.4),
    Math.fround(-0.1)
  ]);
});

test('leaves an already-mono input unchanged', () => {
  const mono = Float32Array.from([0.1, -0.2]);
  assert.equal(downmixToMono([mono]), mono);
});
