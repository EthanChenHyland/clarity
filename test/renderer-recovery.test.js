const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RECOVERY_WINDOW_MS,
  MAX_AUTOMATIC_RELOADS,
  planRendererRecovery,
} = require('../src/renderer-recovery');

test('renderer recovery reloads isolated crashes but stops a crash loop', () => {
  const t0 = 1_000_000;
  const first = planRendererRecovery([], t0, 'crashed');
  assert.equal(first.action, 'reload');
  const second = planRendererRecovery(first.history, t0 + 1000, 'oom');
  assert.equal(second.action, 'reload');
  assert.equal(second.history.length, MAX_AUTOMATIC_RELOADS);
  const third = planRendererRecovery(second.history, t0 + 2000, 'crashed');
  assert.equal(third.action, 'stop');

  const later = planRendererRecovery(third.history, t0 + RECOVERY_WINDOW_MS + 3000, 'crashed');
  assert.equal(later.action, 'reload');
  assert.equal(later.history.length, 1);
});

test('clean renderer exits are not restarted', () => {
  assert.equal(planRendererRecovery([1], 2, 'clean-exit').action, 'none');
});
