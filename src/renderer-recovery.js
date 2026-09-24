const RECOVERY_WINDOW_MS = 30_000;
const MAX_AUTOMATIC_RELOADS = 2;

function planRendererRecovery(history = [], now = Date.now(), reason = 'crashed') {
  if (reason === 'clean-exit') return { action: 'none', history: history.slice() };
  const recent = history.filter((timestamp) => now - timestamp < RECOVERY_WINDOW_MS);
  if (recent.length >= MAX_AUTOMATIC_RELOADS) {
    return { action: 'stop', history: recent };
  }
  return { action: 'reload', history: [...recent, now] };
}

module.exports = {
  RECOVERY_WINDOW_MS,
  MAX_AUTOMATIC_RELOADS,
  planRendererRecovery,
};
