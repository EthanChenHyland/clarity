const assert = require('node:assert/strict');
const test = require('node:test');

const { installRuntimeCompatibility } = require('../src/runtime-compat');

test('legacy Node runtime receives the web APIs used by Clarity providers', () => {
  const target = {};
  const installed = installRuntimeCompatibility(target);

  for (const name of ['fetch', 'Headers', 'Request', 'Response', 'ReadableStream', 'WritableStream', 'TransformStream', 'FormData', 'Blob', 'File']) {
    assert.equal(typeof target[name], 'function', `${name} should be installed`);
  }
  assert.ok(installed.includes('fetch'));
  assert.ok(installed.includes('ReadableStream'));
  assert.ok(installed.includes('FormData'));
});
