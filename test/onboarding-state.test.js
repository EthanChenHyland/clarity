const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');

test('first-run onboarding is explicit and completing it preserves configured settings', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-onboarding-'));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };

  const storePath = path.join(root, 'src', 'store.js');
  delete require.cache[require.resolve(storePath)];
  try {
    const store = require(storePath);
    assert.equal(store.getSettings().onboarded, false);

    store.setSettings({
      provider: 'custom',
      sttProvider: 'local',
      smart: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      models: { custom: { fast: 'deepseek/deepseek-v4.1-flash', smart: 'openai/gpt-5.6-sol' } }
    });
    store.setSettings({ onboarded: true });

    const persisted = store.getSettings();
    assert.equal(persisted.onboarded, true);
    assert.equal(persisted.provider, 'custom');
    assert.equal(persisted.sttProvider, 'local');
    assert.equal(persisted.smart, true);
    assert.equal(persisted.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(persisted.models.custom.fast, 'deepseek/deepseek-v4.1-flash');
    assert.equal(persisted.models.custom.smart, 'openai/gpt-5.6-sol');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(storePath)];
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('renderer only shows onboarding when first-run state is incomplete', () => {
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  const finishStart = renderer.indexOf('async function finishOnboard()');
  const finishEnd = renderer.indexOf("$('#ob-next')", finishStart);
  const finish = renderer.slice(finishStart, finishEnd);

  assert.match(renderer, /if \(!settings\.onboarded\) showOnboard\(\)/);
  assert.match(finish, /clarity\.settingsSet\(\{ onboarded: true \}\)/);
  assert.doesNotMatch(finish, /provider|models|sttProvider|apiKeys|resumeText|jobDescription/);
});

test('renderer UI sources contain no emoji characters', () => {
  const files = ['renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css', 'renderer/permissions.html'];
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(emoji.test(source), false, `${file} still contains emoji/dingbat characters`);
  }
});


test('startup leaves permission setup in the tutorial until onboarding is complete', async () => {
  const vm = require('node:vm');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = main.indexOf('app.whenReady().then(async () => {');
  const end = main.indexOf("app.on('will-quit'", start);
  for (const onboarded of [false, true]) {
    for (const granted of [false, true]) {
      const calls = [];
      let startup;
      vm.runInNewContext(main.slice(start, end), {
        app: { whenReady: () => ({ then: fn => { startup = fn(); } }), on: () => {} },
        hasSingleInstanceLock: true, isMac: true,
        win: { isDestroyed: () => false, webContents: { isLoading: () => false } },
        store: { getSettings: () => ({ onboarded }) },
        launchApp: () => calls.push('main'),
        requestPermissions: async () => { calls.push('check'); return granted; },
        createPermissionsWindow: () => calls.push('permissions')
      });
      await startup;
      assert.deepEqual(calls, !onboarded ? ['main'] : granted ? ['main', 'check'] : ['main', 'check', 'permissions']);
    }
  }
});
