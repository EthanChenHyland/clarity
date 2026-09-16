const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const storePath = path.join(root, 'src', 'store.js');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });

function loadStore(userDataPath) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve(storePath)];
  try {
    return require(storePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('loads existing Clarity settings without losing configured values', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-store-load-'));
  const userData = path.join(parent, 'Clarity');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'clarity-data.json'), JSON.stringify({
    onboarded: true,
    provider: 'anthropic',
    saveTranscripts: true,
    models: { anthropic: { fast: 'claude-3-5-haiku-latest', smart: 'claude-3-5-sonnet-latest' } }
  }));

  try {
    const store = loadStore(userData);
    const settings = store.getSettings();
    assert.equal(settings.onboarded, true);
    assert.equal(settings.provider, 'anthropic');
    assert.equal(settings.saveTranscripts, true);
    assert.equal(settings.models.anthropic.fast, store.CURRENT_ANTHROPIC_FAST);
    assert.equal(settings.models.anthropic.smart, store.CURRENT_ANTHROPIC_SMART);

    store.setSettings({ smart: true });
    const clarityFile = path.join(userData, 'clarity-data.json');
    assert.ok(fs.existsSync(clarityFile));
    assert.equal(JSON.parse(fs.readFileSync(clarityFile, 'utf8')).smart, true);
    assert.deepEqual(fs.readdirSync(userData).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    delete require.cache[require.resolve(storePath)];
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('failed atomic save throws and leaves the in-memory settings unchanged', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-store-failure-'));
  const userData = path.join(parent, 'Clarity');
  fs.mkdirSync(userData, { recursive: true });
  const originalRename = fs.renameSync;

  try {
    const store = loadStore(userData);
    store.setSettings({ provider: 'openai' });
    fs.renameSync = () => { throw new Error('simulated rename failure'); };
    assert.throws(
      () => store.setSettings({ provider: 'anthropic' }),
      /Could not save Clarity settings: simulated rename failure/
    );
    assert.equal(store.getSettings().provider, 'openai');
    assert.deepEqual(fs.readdirSync(userData).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[require.resolve(storePath)];
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('malformed settings are preserved before defaults can replace them', () => {
  const parent = fs.mkdtempSync(path.join(root, '.cache', 'store-recovery-'));
  const file = path.join(parent, 'clarity-data.json');
  const recoverable = '{"apiKeys":{"openai":"test-recoverable-key"},';
  fs.writeFileSync(file, recoverable);
  try {
    const store = loadStore(parent);
    store.setSettings({ smart: true });
    const backup = fs.readdirSync(parent).find(name => name.startsWith('clarity-data.json.recovery-'));
    assert.ok(backup);
    assert.equal(fs.readFileSync(path.join(parent, backup), 'utf8'), recoverable);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('settings reject prototype keys without altering other objects', () => {
  const parent = fs.mkdtempSync(path.join(root, '.cache', 'store-prototype-'));
  try {
    const store = loadStore(parent);
    store.setSettings(JSON.parse('{"__proto__":{"polluted":true},"smart":true}'));
    assert.equal(store.getSettings().smart, true);
    assert.equal(store.getSettings().polluted, undefined);
    assert.equal({}.polluted, undefined);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('fresh users save transcripts and get live answers by default; explicit opt-outs survive reload', () => {
  const userData = fs.mkdtempSync(path.join(root, '.cache', 'defaults-'));
  try {
    let store = loadStore(userData);
    assert.equal(store.getSettings().saveTranscripts, true);
    assert.equal(store.getSettings().liveAnswerSuggestions, true);
    assert.equal(store.getSettings().localWhisper.modelId, 'small.en');
    store.setSettings({ saveTranscripts: false, liveAnswerSuggestions: false });
    store = loadStore(userData);
    assert.equal(store.getSettings().saveTranscripts, false);
    assert.equal(store.getSettings().liveAnswerSuggestions, false);
  } finally {
    delete require.cache[require.resolve(storePath)];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});


test('Custom defaults populate fresh and legacy empty settings while preserving configured endpoints and models', () => {
  const userData = fs.mkdtempSync(path.join(root, '.cache', 'custom-defaults-'));
  try {
    let store = loadStore(userData);
    assert.equal(store.getSettings().baseUrl, 'https://openrouter.ai/api/v1');
    assert.deepEqual(store.getSettings().models.custom, {
      fast: 'deepseek/deepseek-v4.1-flash', smart: 'openai/gpt-5.6-sol'
    });
    fs.writeFileSync(path.join(userData, 'clarity-data.json'), JSON.stringify({
      baseUrl: '', models: { custom: { fast: '', smart: '' } }
    }));
    store = loadStore(userData);
    assert.equal(store.getSettings().models.custom.fast, 'deepseek/deepseek-v4.1-flash');
    store.setSettings({ baseUrl: 'https://example.com/v1', models: { custom: { fast: 'my-model', smart: '' } } });
    store = loadStore(userData);
    assert.equal(store.getSettings().baseUrl, 'https://example.com/v1');
    assert.deepEqual(store.getSettings().models.custom, { fast: 'my-model', smart: '' });
  } finally {
    delete require.cache[require.resolve(storePath)];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
