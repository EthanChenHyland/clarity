const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { abortable } = require('../src/abortable');
function harness(needsScreen = false) {
  const events = [], streams = [];
  let resolveScreen;
  const context = vm.createContext({
    AbortController, abortable, setTimeout, clearTimeout,
    state: { busy: false }, liveAnswerTimer: null, STREAM_INACTIVITY_MS: 25000,
    MODES: { ask: { needsScreen, userBubble: null, build: () => 'question' } },
    store: { getSettings: () => ({ provider: 'test' }) },
    createLLM: () => ({ ready: true, stream: options => { streams.push(options); return new Promise(() => {}); } }),
    transcript: [], detectCategory: () => null, buildInterviewContext: () => '',
    send: (channel, data) => events.push({ channel, data }), recordEvent: () => {},
    isMac: true, systemPreferences: { getMediaAccessStatus: () => 'granted' }, win: null,
    captureScreenshot: () => new Promise(resolve => { resolveScreen = resolve; })
  });
  const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('// -------- feature runner'), source.indexOf('// -------- IPC --------')), context);
  return { context, events, streams, resolveScreen: () => resolveScreen('image') };
}
test('Stop aborts a noncooperative provider, drops late tokens and permits another response', async () => {
  const h = harness();
  const first = h.context.runFeature('ask', 'one');
  h.streams[0].onToken('partial');
  h.context.stopResponse();
  h.context.stopResponse();
  await first;
  assert.equal(h.context.state.busy, false);
  assert.equal(h.streams[0].signal.aborted, true);
  assert.equal(h.events.filter(e => e.channel === 'llm:done').length, 1);
  assert.equal(h.events.at(-1).data.stopped, true);
  assert.equal(h.events.some(e => e.channel === 'llm:error'), false);
  const second = h.context.runFeature('ask', 'two');
  h.streams[0].onToken('late');
  h.streams[1].onToken('new');
  assert.deepEqual(h.events.filter(e => e.channel === 'llm:token').map(e => e.data.text), ['partial', 'new']);
  h.context.stopResponse(); await second;
});
test('Stop during screen preparation returns promptly and never starts the provider', async () => {
  const h = harness(true);
  const pending = h.context.runFeature('ask', 'question');
  h.context.stopResponse(); await pending;
  h.resolveScreen(); await Promise.resolve();
  assert.equal(h.context.state.busy, false);
  assert.equal(h.streams.length, 0);
  assert.equal(h.events.at(-1).data.stopped, true);
});
test('Stop control stays actionable and submitting while busy preserves the draft', () => {
  const source = fs.readFileSync(require.resolve('../renderer/renderer.js'), 'utf8');
  const button = { classList: { toggle: () => {} }, setAttribute: (key, value) => { button[key] = value; } };
  const context = vm.createContext({
    busy: false, $: () => button, icon: name => name, setTimeout: () => 1, clearTimeout: () => {},
    input: { value: 'my next question' }, showStatus: () => {}
  });
  vm.runInContext(source.slice(source.indexOf('  let busyFailsafe'), source.indexOf('  // ---- transcript helpers')), context);
  vm.runInContext(source.slice(source.indexOf('  function send()'), source.indexOf("  $('#send-btn').addEventListener")), context);
  context.setBusy(true);
  assert.equal(button['aria-label'], 'Stop response');
  assert.equal(button.innerHTML, 'stop-square');
  context.send();
  assert.equal(context.input.value, 'my next question');
  context.setBusy(false);
  assert.equal(button['aria-label'], 'Send message');
  assert.equal(button.innerHTML, 'play');
});
