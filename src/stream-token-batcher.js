function createStreamTokenBatcher(send, {
  delayMs = 16,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let firstSent = false;
  let pending = '';
  let timer = null;

  const flush = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!pending) return;
    const text = pending;
    pending = '';
    send(text);
  };

  const push = (text) => {
    if (!text) return;
    // Preserve true first-token latency. Only the follow-on flood is batched.
    if (!firstSent) {
      firstSent = true;
      send(text);
      return;
    }
    pending += text;
    if (timer === null) timer = setTimer(flush, delayMs);
  };

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = '';
  };

  return { push, flush, cancel };
}

module.exports = { createStreamTokenBatcher };
