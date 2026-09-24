'use strict';

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function streamWithSmartFallback({ fast, smart, streamOptions, signal, fallbackDelayMs = 3000, onWinner = () => {} }) {
  if (!fast || !fast.ready) return Promise.reject(new Error('Fast model is not ready.'));
  if (!smart || !smart.ready || smart.model === fast.model) return fast.stream({ ...streamOptions, signal });

  const fastController = new AbortController();
  const smartController = new AbortController();

  return new Promise((resolve, reject) => {
    let winner = null;
    let finished = false;
    let smartStarted = false;
    const status = { fast: 'running', smart: 'idle' };
    const errors = {};
    let fallbackTimer = null;

    const cleanup = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      signal?.removeEventListener?.('abort', abortAll);
    };

    const settleResolve = (value) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };

    const abortAll = () => {
      fastController.abort();
      smartController.abort();
      settleReject(signal?.reason instanceof Error ? signal.reason : abortError());
    };

    const chooseWinner = (label, llm) => {
      if (!winner) {
        winner = label;
        if (label === 'fast') smartController.abort();
        else fastController.abort();
        if (fallbackTimer) clearTimeout(fallbackTimer);
        onWinner(label, llm.model);
      }
      return winner === label;
    };

    const maybeReject = () => {
      if (winner || finished) return;
      if (status.fast === 'error' && status.smart === 'error') {
        settleReject(errors.smart || errors.fast || new Error('Both models failed.'));
      }
    };

    const startSmart = () => {
      if (smartStarted || finished || winner) return;
      smartStarted = true;
      run('smart', smart, smartController);
    };

    const run = (label, llm, controller) => {
      status[label] = 'running';
      llm.stream({
        ...streamOptions,
        signal: controller.signal,
        onProgress: () => {
          if (!winner || winner === label) streamOptions.onProgress?.();
        },
        onToken: (token) => {
          if (chooseWinner(label, llm)) streamOptions.onToken?.(token);
        }
      }).then((result) => {
        status[label] = 'done';
        if (finished) return;
        if (!winner) chooseWinner(label, llm);
        if (winner === label) settleResolve(result);
      }).catch((error) => {
        if (finished) return;
        if (controller.signal.aborted && winner && winner !== label) return;
        status[label] = 'error';
        errors[label] = error;
        if (winner === label) {
          settleReject(error);
          return;
        }
        if (label === 'fast' && !smartStarted) startSmart();
        maybeReject();
      });
    };

    fallbackTimer = setTimeout(startSmart, Math.max(250, Number(fallbackDelayMs) || 3000));
    if (signal?.aborted) {
      abortAll();
      return;
    }
    signal?.addEventListener?.('abort', abortAll, { once: true });
    run('fast', fast, fastController);
  });
}

module.exports = { streamWithSmartFallback };
