const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function nativeHarness() {
  const source = read('main.js');
  const levels = [];
  let focused = true, now = 0;
  const timers = new Map();
  const context = vm.createContext({
    isMac: true, win: { isDestroyed: () => false, isFocused: () => focused,
      setAlwaysOnTop: (active) => levels.push(active), blur: () => { focused = false; } },
    permWin: null, settingsPriorityActive: false, externalSettingsActive: false,
    nativeUiDepth: 0, nativeUiRestorePending: false, nativeUiRestoreTimer: null,
    nativeUiRestoreNotBefore: 0, permissionsHiddenForNativeUi: false,
    NATIVE_UI_RESTORE_GRACE_MS: 1200, MAIN_WINDOW_LEVEL: 1, SETTINGS_WINDOW_LEVEL: 3,
    Date: { now: () => now }, setTimeout: (cb) => { const id = {}; timers.set(id, cb); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(source.slice(source.indexOf('function isForegroundYieldActive'), source.indexOf('async function showNativeOpenDialog')), context);
  return { context, levels, focus: () => { focused = true; }, advance: () => { now += 1300; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(cb => cb()); } };
}

test('overlapping native operations cannot restore Clarity over an unfinished system sheet', () => {
  const h = nativeHarness();
  h.context.beginNativeUiYield({ blur: false });
  h.context.beginNativeUiYield();
  h.context.endNativeUiYield();
  h.advance();
  assert.deepEqual(h.levels, [false]);
  h.context.endNativeUiYield();
  h.advance();
  assert.equal(h.levels.at(-1), true);
});

test('native sheet completion waits for return focus; picker-free yield preserves focus', () => {
  const h = nativeHarness();
  h.context.beginNativeUiYield();
  h.context.endNativeUiYield();
  h.advance();
  assert.deepEqual(h.levels, [false]);
  h.focus(); h.context.restoreAfterNativeUiYield();
  assert.equal(h.levels.at(-1), true);
  h.context.beginNativeUiYield({ blur: false });
  h.context.endNativeUiYield(); h.advance();
  assert.equal(h.levels.at(-1), true);
});

function captureHarness({ mic, display, access = 'granted' } = {}) {
  const source = read('renderer/renderer.js');
  const messages = [];
  const context = vm.createContext({
    isMac: true, isWindows: false,
    navigator: { mediaDevices: { getUserMedia: mic, getDisplayMedia: display } },
    clarity: { platform: 'darwin', permissionsCheck: async () => ({ mic: 'granted', screen: access }),
      beginSystemAudioPermissionPrompt: async () => {}, endSystemAudioPermissionPrompt: async () => {}, log: () => {} },
    showStatus: text => messages.push(text),
    AudioContext: class { constructor() { throw new Error('Unexpected audio graph after cancellation'); } }
  });
  vm.runInContext(source.slice(source.indexOf('  let audioCtx ='), source.indexOf('  // ---- STT / VAD status helpers')), context);
  return { context, messages };
}

test('Stop during microphone acquisition disposes the late stream', async () => {
  const request = deferred(); const requested = deferred(); let stopped = 0;
  const h = captureHarness({ mic: () => { requested.resolve(); return request.promise; } });
  const starting = h.context.startMic();
  await requested.promise;
  h.context.stopMic();
  request.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await starting;
  assert.equal(stopped, 1);
  assert.deepEqual(h.messages, []);
});

test('missing screen access never invokes display capture or a recording probe', async () => {
  let captures = 0;
  const h = captureHarness({ access: 'denied', display: () => { captures++; } });
  await h.context.startSystemAudio(); await h.context.startSystemAudio();
  assert.equal(captures, 0);
  assert.match(h.messages[0], /Screen & System Audio Recording/);
});

test('Stop during system-audio acquisition disposes the late stream', async () => {
  const request = deferred(); const requested = deferred(); let stopped = 0;
  const h = captureHarness({ display: () => { requested.resolve(); return request.promise; } });
  const starting = h.context.startSystemAudio();
  await requested.promise;
  h.context.stopSystemAudio();
  request.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await starting;
  assert.equal(stopped, 1);
  assert.deepEqual(h.messages, []);
});

test('history stays beside the main panel at the default window width', () => {
  const source = read('renderer/renderer.js');
  const values = {};
  const context = vm.createContext({ window: { innerWidth: 1130 }, document: { getElementById: id => id === 'panel'
    ? { getBoundingClientRect: () => ({ top: 66, right: 877, height: 345 }) }
    : { classList: { contains: () => false }, style: { setProperty: (k,v) => { values[k] = v; } } } } });
  vm.runInContext(source.slice(source.indexOf('function syncHistorySidebarGeometry'), source.indexOf('  const historyPanel =')), context);
  context.syncHistorySidebarGeometry();
  assert.equal(values['--history-left'], '889px');
  assert.equal(values['--history-height'], '345px');
});

test('reasoning stream events count as progress without exposing hidden reasoning', async () => {
  const source = read('src/llm.js');
  let progress = 0, options;
  const tokens = [];
  const signal = new AbortController().signal;
  const context = vm.createContext({ require: () => class {
    chat = { completions: { create: async (_request, opts) => {
      options = opts;
      return (async function* () {
        yield { choices: [{ delta: { reasoning: 'private reasoning' } }] };
        yield { choices: [{ delta: { reasoning: 'still thinking' } }] };
        yield { choices: [{ delta: { content: 'Answer' } }] };
      })();
    } } };
  } });
  vm.runInContext(source.slice(source.indexOf('async function streamOpenAI'), source.indexOf('// Azure AI Foundry Models')), context);
  const answer = await context.streamOpenAI({ apiKey: 'test', model: 'test', turns: [], onToken: t => tokens.push(t), onProgress: () => progress++, signal });
  assert.equal(answer, 'Answer');
  assert.deepEqual(tokens, ['Answer']);
  assert.equal(progress, 3);
  assert.equal(options.signal, signal);
});

for (const channel of ['mic', 'system']) {
  test(`${channel} audio resumes its context, renders through a silent worklet, and releases capture on Stop`, async () => {
    let resumed = 0, closed = 0, stopped = 0, connected = 0, disconnected = 0;
    const track = { label: 'Test input', muted: false, stop: () => stopped++ };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
    const h = captureHarness({ mic: async () => stream, display: async () => stream });
    h.context.AudioContext = class {
      constructor() { this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
      async resume() { resumed++; }
      close() { closed++; }
      createMediaStreamSource() { return { connect() {} }; }
    };
    h.context.MediaStream = class {};
    h.context.AudioWorkletNode = class {
      constructor() { this.port = {}; }
      connect() { connected++; }
      disconnect() { disconnected++; }
    };
    await h.context[channel === 'mic' ? 'startMic' : 'startSystemAudio']();
    assert.equal(resumed, 1);
    assert.equal(connected, 1);
    h.context[channel === 'mic' ? 'stopMic' : 'stopSystemAudio']();
    assert.equal(disconnected, 1);
    assert.equal(closed, 1);
    assert.equal(stopped, 1);
  });
}

test('capture worklet emits PCM without playing microphone or meeting audio back to the speakers', () => {
  let Processor;
  const messages = [];
  vm.runInNewContext(read('renderer/audio-worklet-processor.js'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: pcm => messages.push(pcm) }; } },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
  });
  const processor = new Processor();
  const input = new Float32Array(4096).fill(0.5);
  const output = new Float32Array(4096);
  processor.process([[input]], [[output]], {});
  assert.equal(messages.length, 1);
  assert.equal(new Int16Array(messages[0])[0], 16383);
  assert.ok(output.every(sample => sample === 0));
});

function externalHandoffHarness() {
  const source = read('main.js');
  let dockVisible = false, focused = true;
  const events = [];
  const context = vm.createContext({
    isMac: true, app: { dock: { isVisible: () => dockVisible,
      show: async () => { dockVisible = true; events.push('dock-show'); },
      hide: () => { dockVisible = false; events.push('dock-hide'); } } },
    win: { isDestroyed: () => false, setAlwaysOnTop: value => events.push(['top', value]),
      blur: () => { focused = false; }, show: () => events.push('show'),
      focus: () => { focused = true; }, setIgnoreMouseEvents: () => {} },
    permWin: null, externalSettingsActive: false, externalSettingsRestoreAfter: 0,
    externalSettingsPane: 'screen',
    permissionsHiddenForNativeUi: false, permissionsHiddenForExternalSettings: false,
    nativeUiDepth: 0, nativeUiRestorePending: false, settingsPriorityActive: false,
    restoreAfterNativeUiYield: () => { assert.ok(focused); events.push('restore'); },
    isForegroundYieldActive: () => context.externalSettingsActive,
    setTimeout: () => {}, Date,
  });
  vm.runInContext(source.slice(source.indexOf('async function yieldToExternalSettings()'), source.indexOf('function isForegroundYieldActive()')), context);
  vm.runInContext(source.slice(source.indexOf('function returnToClarity()'), source.indexOf('// -------- lifecycle --------')), context);
  return { context, events, visible: () => dockVisible };
}

test('external Settings handoff keeps Clarity reachable and explicit return restores the same window', async () => {
  const h = externalHandoffHarness();
  await h.context.yieldToExternalSettings();
  assert.equal(h.visible(), false);
  assert.equal(h.context.externalSettingsActive, true);
  assert.deepEqual(h.events, [['top', false]]);
  h.context.returnToClarity();
  assert.equal(h.context.externalSettingsActive, false);
  assert.equal(h.visible(), false);
  assert.ok(h.events.includes('show'));
  assert.ok(h.events.includes('restore'));
});

test('repeated Settings handoffs never expose Clarity in the Dock', async () => {
  const h = externalHandoffHarness();
  await h.context.yieldToExternalSettings();
  await h.context.yieldToExternalSettings();
  h.context.returnToClarity();
  assert.equal(h.visible(), false);
});

test('returning to Clarity does not raise its window over an unfinished native sheet', () => {
  const h = externalHandoffHarness();
  h.context.nativeUiDepth = 1;
  h.context.returnToClarity();
  assert.deepEqual(h.events, []);
});

function microphonePermissionHarness(status) {
  const source = read('main.js');
  const answer = deferred();
  let prompts = 0, yields = 0, opens = 0;
  const context = vm.createContext({
    isMac: true,
    systemPreferences: { getMediaAccessStatus: () => status,
      askForMediaAccess: () => { prompts++; return answer.promise; } },
    withNativeUiYield: async operation => { yields++; return operation(); },
    yieldToExternalSettings: async () => {}, returnToClarity: () => {},
    shell: { openExternal: async () => { opens++; } },
    getPermissionStatus: async () => ({ mic: status, screen: 'denied' }),
  });
  vm.runInContext(source.slice(source.indexOf('let microphonePermissionRequest ='), source.indexOf('function createPermissionsWindow()')), context);
  return { context, answer, counts: () => ({ prompts, yields, opens }) };
}

test('simultaneous microphone permission clicks share one native prompt', async () => {
  const h = microphonePermissionHarness('not-determined');
  const first = h.context.requestMicrophoneAccess();
  const second = h.context.requestMicrophoneAccess();
  assert.deepEqual(h.counts(), { prompts: 1, yields: 1, opens: 0 });
  h.answer.resolve(true);
  await Promise.all([first, second]);
});

test('startup checks never request access; granted microphones never yield or prompt', async () => {
  const pending = microphonePermissionHarness('not-determined');
  assert.equal(await pending.context.requestPermissions(), false);
  assert.deepEqual(pending.counts(), { prompts: 0, yields: 0, opens: 0 });
  const granted = microphonePermissionHarness('granted');
  await granted.context.requestMicrophoneAccess();
  assert.deepEqual(granted.counts(), { prompts: 0, yields: 0, opens: 0 });
});

test('denied microphone access opens Settings without a redundant native request', async () => {
  const h = microphonePermissionHarness('denied');
  await h.context.requestMicrophoneAccess();
  assert.deepEqual(h.counts(), { prompts: 0, yields: 0, opens: 1 });
});

test('focus on Clarity permission window completes native restoration instead of leaving a pending yield', () => {
  const h = nativeHarness();
  h.context.beginNativeUiYield();
  h.context.permWin = { isDestroyed: () => false, isFocused: () => true };
  h.context.endNativeUiYield();
  h.advance();
  assert.equal(h.context.nativeUiRestorePending, false);
  assert.equal(h.levels.at(-1), true);
});


test('audio source selection skips thumbnail capture and preserves permission gating and loopback', async () => {
  const source = read('main.js');
  const start = source.indexOf('session.defaultSession.setDisplayMediaRequestHandler(');
  const end = source.indexOf('}, { useSystemPicker: false });', start) + '}, { useSystemPicker: false });'.length;
  let handler, options, enumerations = 0, granted = false;
  const display = { id: 'screen:1:0', display_id: '1' };
  vm.runInNewContext(source.slice(start, end), {
    session: { defaultSession: { setDisplayMediaRequestHandler: (fn, opts) => { handler = fn; options = opts; } } },
    isMac: true, isWindows: false,
    getScreenPermissionStatus: () => granted ? 'granted' : 'denied',
    desktopCapturer: { getSources: async opts => {
      enumerations++;
      assert.deepEqual(JSON.parse(JSON.stringify(opts)), { types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      return [display];
    } }
  });
  assert.equal(options.useSystemPicker, false);
  const blocked = await new Promise(resolve => handler({}, resolve));
  assert.equal(blocked, undefined);
  assert.equal(enumerations, 0);
  granted = true;
  const selected = await new Promise(resolve => handler({}, resolve));
  assert.equal(enumerations, 1);
  assert.equal(selected.video, display);
  assert.equal(selected.audio, 'loopback');
});

test('all native file dialogs hide the overlay and restore it on cancellation or failure', async () => {
  const source = read('main.js');
  const start = source.indexOf('async function showNativeOpenDialog(');
  const end = source.indexOf('// Keep the preload channel names stable', start);
  for (const fails of [false, true]) {
    const events = [];
    const context = vm.createContext({
      win: { isDestroyed: () => false, isVisible: () => true,
        hide: () => events.push('hide') },
      returnToClarity: () => events.push('restore'),
      withNativeUiYield: async operation => operation(),
      dialog: { showOpenDialog: async (...args) => {
        assert.equal(args.length, 1);
        events.push('dialog');
        if (fails) throw new Error('open failed');
        return { canceled: true, filePaths: [] };
      } }
    });
    vm.runInContext(source.slice(start, end), context);
    const operation = context.showNativeOpenDialog({ title: 'Import file' });
    if (fails) await assert.rejects(operation, /open failed/);
    else assert.equal((await operation).canceled, true);
    assert.deepEqual(events, ['hide', 'dialog', 'restore']);
  }
});

test('click-through wakes over native toolbar without renderer mouse events and respects native dialogs', () => {
  const source = read('main.js');
  let handler, tick, cursor = { x: 0, y: 0 }, yielding = false;
  const changes = [], sent = [];
  const win = { isDestroyed: () => false, isVisible: () => true,
    webContents: { getZoomFactor: () => 1 },
    getBounds: () => ({ x: 100, y: 200 }), setIgnoreMouseEvents: value => changes.push(value) };
  vm.runInNewContext(source.slice(source.indexOf('let toolbarWakeTimer'), source.indexOf('function isAllowedPaneUrl')), {
    win, ipcMain: { on: (_name, callback) => { handler = callback; } },
    isMainRendererSender: sender => sender === 'main', isForegroundYieldActive: () => yielding,
    screen: { getCursorScreenPoint: () => cursor }, send: channel => sent.push(channel),
    setInterval: callback => { tick = callback; return { unref() {} }; }, clearInterval() {}
  });
  handler({ sender: 'other' }, true, {});
  assert.deepEqual(changes, []);
  handler({ sender: 'main' }, true, { x: 10, y: 10, width: 100, height: 40 });
  tick(); assert.deepEqual(changes, [true]);
  cursor = { x: 125, y: 225 }; yielding = true;
  tick(); assert.deepEqual(changes, [true]);
  yielding = false; tick();
  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(sent, ['mouse:interactive']);
});
