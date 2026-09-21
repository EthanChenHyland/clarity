/* Clarity renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const clarity = window.clarity; // exposed by preload
  const $ = (s) => document.querySelector(s);
  const isWindows = clarity.platform === 'win32';
  const isMac = clarity.platform === 'darwin';

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('circle-help', { size: 15 });
  $('.drag-icon').innerHTML = icon('move', { size: 15 });
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  $('#stop-btn').innerHTML = icon('play', { size: 15 });
  $('#toolbar-settings-btn').innerHTML = icon('settings', { size: 15 });
  $('#quit-btn').innerHTML = icon('x', { size: 15 });
  $('#quit-btn').addEventListener('click', () => clarity.quit());
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', { size: 16 });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('refresh-cw', { size: 16 });
  document.querySelector('.act[data-mode="leetcode"] .ic').innerHTML = icon('code-2', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('settings', { size: 17 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });
  const clearIC = document.querySelector('#clear-transcript-btn .ic');
  if (clearIC) clearIC.innerHTML = icon('trash-2', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let whisperOverview = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;
  let responseCount = 0;
  const MAX_RESPONSES = 20;

  const messages = $('#messages');
  let activeResponseGroup = null;
  let streamScrollFrame = null;

  function scrollResponseIntoView(group, behavior = 'smooth') {
    if (!group || !group.isConnected) return;
    const messagesRect = messages.getBoundingClientRect();
    const groupRect = group.getBoundingClientRect();
    const top = Math.max(0, messages.scrollTop + groupRect.top - messagesRect.top);
    messages.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior });
  }

  function scheduleStreamScroll() {
    if (streamScrollFrame) return;
    streamScrollFrame = requestAnimationFrame(() => {
      streamScrollFrame = null;
      if (!activeResponseGroup || !activeResponseGroup.isConnected) return;
      messages.scrollTo({ top: messages.scrollHeight, behavior: 'auto' });
    });
  }

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderMarkdown(text) {
    return ClarityMarkdown.renderMarkdown(text);
  }

  let markdownTimer = null;
  function clearMessages() {
    clearTimeout(markdownTimer); markdownTimer = null;
    messages.innerHTML = '';
    messages.classList.remove('start-state');
    aiEl = null; caretEl = null; activeResponseGroup = null;
    if (streamScrollFrame) cancelAnimationFrame(streamScrollFrame);
    streamScrollFrame = null;
  }

  function addUserBubble(text) {
    messages.classList.remove('start-state');
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small) {
    messages.classList.remove('start-state');
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    // Guard: caretEl must be a child of aiEl
    if (caretEl && caretEl.parentNode === aiEl) {
      aiEl.insertBefore(span, caretEl);
    } else {
      aiEl.appendChild(span);
    }
    if (!markdownTimer) markdownTimer = setTimeout(() => {
      markdownTimer = null;
      if (!aiEl) return;
      aiEl.innerHTML = renderMarkdown(aiEl.dataset.raw || '');
      caretEl = document.createElement('span');
      caretEl.className = 'ai-caret';
      aiEl.appendChild(caretEl);
      scheduleStreamScroll();
    }, 120);
    scheduleStreamScroll();
  }

  function finalizeAi() {
    clearTimeout(markdownTimer); markdownTimer = null;
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
  }

  let busyFailsafe = null;
  function setBusy(v) {
    busy = v;
    const button = $('#send-btn');
    button.classList.toggle('busy', v);
    button.innerHTML = icon(v ? 'stop-square' : 'play', { size: 15 });
    button.title = v ? 'Stop response' : 'Send';
    button.setAttribute('aria-label', v ? 'Stop response' : 'Send message');
    clearTimeout(busyFailsafe);
    // Failsafe: main has a 25s stream watchdog that always sends llm:done/llm:error, but if a
    // terminal event is ever lost the whole UI stays frozen. Allow the main process
    // its full three-minute deadline, including provider reasoning, before self-clearing.
    if (v) busyFailsafe = setTimeout(() => setBusy(false), 190000);
  }

  // ---- transcript helpers ------------------------------------------------
  // NOTE: The old transcript-list element was renamed to ts-list.
  // These helpers are now deprecated but kept for compatibility.
  // The main sidebar uses appendTranscriptHistoryTurn() instead.
  let transcriptInterimEl = null;

  // FIX #1: Updated to use ts-list instead of non-existent transcript-list

  function clearTranscriptInterim() {
    if (transcriptInterimEl) {
      transcriptInterimEl.remove();
      transcriptInterimEl = null;
    }
  }

  // ---- toast helper ------------------------------------------------------
  // FIX #7: Toast queue system — ensures latest toast wins cleanly without stacking
  let toastTimer = null;
  let toastFadeTimer = null;
  function showToast(message, ms = 3500) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.getElementById('app').appendChild(el);
    }
    // Clear any pending timers to prevent overlap
    clearTimeout(toastTimer);
    clearTimeout(toastFadeTimer);
    // Immediately update content (no stacking)
    el.textContent = message;
    el.classList.add('show');
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, ms);
  }

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text) {
    if (busy) {
      showStatus('AI is still responding', 1400);
      return;
    }
    setBusy(true);
    clarity.ask({ mode, text: text || '' });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  // Question history for undo (Ctrl+Z)
  const questionHistory = [];
  const MAX_QUESTION_HISTORY = 10;
  
  // FIX #9: Send button visual "ready" state
  function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    if (!sendBtn) return;
    
    const hasText = input.value.trim().length > 0;
    sendBtn.classList.remove('ready');
    sendBtn.classList.toggle('has-text', hasText);
  }

  // ---- Save question to history for undo ----
  function saveToQuestionHistory(text) {
    if (!text || text.trim().length < 5) return;
    
    // Don't save duplicates
    const last = questionHistory[questionHistory.length - 1];
    if (last && last.text === text.trim()) return;
    
    questionHistory.push({
      text: text.trim(),
      timestamp: Date.now()
    });
    
    // Keep only recent history
    while (questionHistory.length > MAX_QUESTION_HISTORY) {
      questionHistory.shift();
    }
    
  }
  
  // The history button opens the transcript sidebar, so its badge reflects
  // finalized transcript turns rather than the separate Ctrl/Cmd+Z question
  // undo stack.
  let transcriptHistoryCount = 0;
  function updateHistoryBadge() {
    const historyBtn = document.getElementById('history-btn');
    if (!historyBtn) return;
    
    // Remove existing badge if any
    let badge = historyBtn.querySelector('.history-badge');
    
    const count = transcriptHistoryCount;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'history-badge';
        historyBtn.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // ---- Restore last question from history (Ctrl+Z) ----
  function restoreLastQuestion() {
    const last = questionHistory.pop();
    if (last) {
      input.value = last.text;
      syncPlaceholder();
      updateSendButtonState();
      showToast('Question restored', 1500);
      return true;
    }
    showToast('No question to restore', 1500);
    return false;
  }

  // ---- Clear the user's typed question ----
  function clearQuestionInput(showUndoHint = false) {
    const hadContent = input.value.trim().length > 0;
    saveToQuestionHistory(input.value);
    input.value = '';
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    syncPlaceholder();
    updateSendButtonState();
    
    // FIX #10: Show undo hint when explicitly cleared
    if (showUndoHint && hadContent) {
      const undoHint = isWindows ? 'Ctrl+Z to undo' : '⌘Z to undo';
      showToast(`Cleared · ${undoHint}`, 2000);
    }
  }

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  
  input.addEventListener('input', () => {
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    syncPlaceholder();
    updateSendButtonState();
  });
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    if (busy) { showStatus('AI is still responding — click Stop to cancel', 1400); return; }
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    
    // Save to history before clearing (in case user wants to redo)
    saveToQuestionHistory(text);
    
    input.value = '';
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    syncPlaceholder();
    updateSendButtonState();
    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', () => {
    if (busy) clarity.stopResponse();
    else send();
  });
  input.addEventListener('keydown', (e) => {
    // Ctrl+Z / Cmd+Z: restore last question if input is empty
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !input.value.trim()) {
      e.preventDefault();
      restoreLastQuestion();
      return;
    }
    // Escape: clear the input (with undo hint)
    if (e.key === 'Escape' && input.value.trim()) {
      e.preventDefault();
      clearQuestionInput(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runMode('assist', ''); }
  });
  
  // FIX #13: Global keyboard shortcut for force-answer (Ctrl+Shift+A / Cmd+Shift+A)
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+A / Cmd+Shift+A: Force answer current question immediately
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (input.value.trim()) send();
      else runMode('say', '');
    }
  });
  
  // FIX #4: Add tooltip with keyboard shortcuts to send button
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    const forceKey = isWindows ? 'Ctrl+Shift+A' : '⌘⇧A';
    sendBtn.title = `Send · ${forceKey} to force answer`;
  }

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    smartBtn.setAttribute('aria-pressed', String(!!settings.smart));
    await clarity.settingsSet({ smart: settings.smart });
  });

  // Hide / collapse
  let panelCollapsed = false;
  let panelHideTimer = null;
  function toggleHide() {
    const panelWrap = $('#panel-wrap');
    const hideBtn = $('#hide-btn');
    if (panelHideTimer) {
      clearTimeout(panelHideTimer);
      panelHideTimer = null;
    }

    panelCollapsed = !panelCollapsed;
    hideBtn.classList.toggle('collapsed', panelCollapsed);
    hideBtn.setAttribute('aria-expanded', String(!panelCollapsed));
    hideBtn.setAttribute('aria-label', panelCollapsed ? 'Show assistant panel' : 'Hide assistant panel');
    const hideLabel = hideBtn.querySelector('span:last-child');
    if (hideLabel) hideLabel.textContent = panelCollapsed ? 'Show' : 'Hide';

    if (!panelCollapsed) {
      panelWrap.classList.remove('collapsed', 'collapsing');
      return;
    }

    // Keep native window geometry fixed: only the renderer shell fades/scales out.
    // If history is open, let it run its matching fade-out at the same time.
    hideSidebar();
    panelWrap.classList.remove('collapsed');
    panelWrap.classList.add('collapsing');

    const finishCollapse = () => {
      panelHideTimer = null;
      if (!panelCollapsed) return;
      panelWrap.classList.remove('collapsing');
      panelWrap.classList.add('collapsed');
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishCollapse();
      return;
    }
    panelHideTimer = setTimeout(finishCollapse, 180);
  }
  $('#hide-btn').addEventListener('click', toggleHide);
  clarity.on('hide:toggle', toggleHide);

  function updateCaptureButton(active) {
    const btn = $('#stop-btn');
    btn.classList.toggle('active', !!active);
    btn.innerHTML = icon(active ? 'stop-square' : 'play', { size: 15 });
    btn.title = active ? 'Stop listening' : 'Start listening';
    btn.setAttribute('aria-label', active ? 'Stop listening' : 'Start listening');
  }

  // Stop = start/stop listening. Kick off system-audio capture straight from the click so
  // the user-gesture is fresh for getDisplayMedia (loopback capture needs it).
  let captureClickPending = false;
  $('#stop-btn').addEventListener('click', async () => {
    if (captureClickPending) return;
    captureClickPending = true;
    try {
    const turningOn = !$('#stop-btn').classList.contains('active');
    if (turningOn) {
      // startSystemAudio may fail (user cancels, no permission) — that's OK,
      // mic will still work and capture will toggle regardless
      try { await startSystemAudio(); } catch (_) { /* handled inside startSystemAudio */ }
    }
    if (!turningOn) { stopMic(); stopSystemAudio(); }
    const toggle = clarity.captureToggle();
    captureClickPending = false;
    const active = await toggle;
    if (turningOn && !active) stopSystemAudio();
    } finally { captureClickPending = false; }
  });

  // Transcript toggle removed — sidebar now auto-opens with listening

  // Clear transcript
  const clearTranscriptBtn = document.getElementById('clear-transcript-btn');
  if (clearTranscriptBtn) {
    clearTranscriptBtn.addEventListener('click', async () => {
      // Save current input to history before clearing (for undo)
      saveToQuestionHistory(input.value);
      
      await clarity.clearTranscript();
      showStartMessage();
      // Also clear the floating interim bar
      if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
      // FIX #1: Use ts-list instead of non-existent transcript-list
      const list = document.getElementById('ts-list');
      if (list) list.innerHTML = '<div class="ts-placeholder">Conversation history will appear here when listening.</div>';
      transcriptInterimEl = null;
      clearTranscriptSidebar(); // clear the history sidebar too
      clearQuestionInput(); // clear only the user's typed question
      
      const undoHint = isWindows ? 'Ctrl+Z to undo' : '⌘Z to undo';
      showToast(`Conversation cleared · ${undoHint} restores your typed question only`, 3500);
    });
  }

  // ---- capture: mic (renderer side) — uses AudioWorklet (modern, off-main-thread) ----
  let audioCtx = null, micStream = null, micWorklet = null, micStarting = false;
  let micGeneration = 0;
  async function startMic(recovering = false) {
    if (micStream || micStarting) return;
    micStarting = true;
    const generation = ++micGeneration;
    let nativePromptActive = false;
    try {
      // Only lower Clarity when macOS can actually show a microphone
      // permission sheet. Once microphone access is already granted (or
      // denied), getUserMedia will not show native UI, and yielding here would
      // make the overlay disappear every time Play is pressed.
      if (clarity.platform === 'darwin') {
        const permissionStatus = await clarity.permissionsCheck();
        if (permissionStatus?.mic === 'not-determined') {
          await clarity.beginNativePermissionPrompt();
          nativePromptActive = true;
        }
      }
      if (generation !== micGeneration) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });
      if (generation !== micGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStream = stream;
      // getUserMedia can resolve with a stream that has no usable audio track
      // (e.g. a virtual/placeholder device, or a device that was unplugged
      // between permission grant and capture start). Fail loudly here instead
      // of silently wiring up an AudioWorklet to nothing — that produces the
      // "Clarity never hears me, no error shown" symptom with no diagnostic at all.
      const [track] = micStream.getAudioTracks();
      if (!track) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
        showStatus('No microphone audio track was available. Check System Settings → Sound for a working input device, then try again.');
        return;
      }
      track.onended = () => {
        if (generation !== micGeneration) return;
        stopMic();
        showStatus('Microphone disconnected. Reconnecting to the default input…', 4000);
        if (!recovering) void startMic(true);
        else showStatus('Microphone disconnected again. Reconnect it, then restart listening.');
      };
      clarity.log('mic stream started: track=' + (track.label || '(no label — permission may be stale)') + ' muted=' + track.muted);
      audioCtx = new AudioContext({ sampleRate: 16000 });
      await audioCtx.resume();
      if (generation !== micGeneration) return;

      // Use AudioWorklet for low-latency, off-main-thread processing
      try {
        await audioCtx.audioWorklet.addModule('audio-worklet-processor.js');
        if (generation !== micGeneration) return;
        const source = audioCtx.createMediaStreamSource(micStream);
        micWorklet = new AudioWorkletNode(audioCtx, 'clarity-audio-processor');
        micWorklet.port.onmessage = (e) => {
          clarity.micPcm(e.data);
        };
        source.connect(micWorklet);
        // The processor leaves its output silent; connecting keeps the graph
        // rendering even when Chromium prunes unconnected audio nodes.
        micWorklet.connect(audioCtx.destination);
        clarity.log('mic AudioWorklet processor attached');
      } catch (workletErr) {
        if (generation !== micGeneration) return;
        // Fallback to ScriptProcessor if AudioWorklet fails (shouldn't happen in Electron 33+)
        clarity.log('AudioWorklet failed, falling back to ScriptProcessor: ' + workletErr.message);
        const micNode = audioCtx.createMediaStreamSource(micStream);
        const micProc = audioCtx.createScriptProcessor(4096, 1, 1);
        const sink = audioCtx.createGain(); sink.gain.value = 0;
        micNode.connect(micProc); micProc.connect(sink); sink.connect(audioCtx.destination);
        micProc.onaudioprocess = (e) => {
          const f = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          clarity.micPcm(out.buffer);
        };
        micWorklet = { _legacy: true, proc: micProc, node: micNode, sink };
      }
    } catch (err) {
      if (generation !== micGeneration) return;
      stopMic();
      const message = err && err.message ? err.message : String(err);
      const name = err && err.name;
      clarity.log('mic error: ' + name + ' — ' + message);
      // getUserMedia's DOMException.name is the reliable signal here — the
      // .message text varies by Chromium version and isn't meant for users.
      // Distinguishing "no device" from "denied" from "in use elsewhere"
      // turns one generic dead end into three different next actions.
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showStatus('No microphone was found. Plug one in, or pick a default input device in your OS sound settings, then try again.');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        showStatus(isWindows
          ? 'Microphone permission was denied. Settings → Privacy & security → Microphone → allow Clarity, then try again.'
          : 'Microphone permission was denied. System Settings → Privacy & Security → Microphone → allow Clarity, then try again.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showStatus('The microphone could not be started — another application may be using it exclusively. Close other apps using the mic and try again.');
      } else {
        showStatus('Microphone capture could not be started. Check your mic permissions and try again.');
      }
    } finally {
      if (nativePromptActive) await clarity.endNativePermissionPrompt();
      if (generation === micGeneration) micStarting = false;
    }
  }
  function stopMic() {
    micGeneration++;
    micStarting = false;
    if (micWorklet) {
      if (micWorklet._legacy) {
        micWorklet.proc.disconnect(); micWorklet.proc.onaudioprocess = null;
        micWorklet.node.disconnect(); micWorklet.sink.disconnect();
      } else {
        micWorklet.disconnect();
      }
      micWorklet = null;
    }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  // ---- capture: system/meeting audio (getDisplayMedia loopback, in Clarity's process) ----
  let sysStream = null, sysCtx = null, sysWorklet = null, sysStarting = false;
  let sysGeneration = 0;
  async function startSystemAudio() {
    // Called both from the stop-btn click (fresh user gesture for getDisplayMedia) and from the
    // capture:state handler. getDisplayMedia is async, so `if (sysStream) return` alone loses the
    // race and can open a second loopback stream that is then orphaned.
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      clarity.log('system audio unavailable: getDisplayMedia not supported');
      showStatus('Meeting audio capture is not available on this device build.');
      return;
    }
    if (sysStream || sysStarting) return;
    sysStarting = true;
    const generation = ++sysGeneration;
    let nativePromptActive = false;
    try {
      if (isMac) {
        const access = await clarity.permissionsCheck();
        if (generation !== sysGeneration) return;
        if (access.screen !== 'granted') {
          showStatus('Enable Clarity in System Settings → Privacy & Security → Screen & System Audio Recording, then Check Access or restart Clarity.');
          return;
        }
        await clarity.beginSystemAudioPermissionPrompt();
        nativePromptActive = true;
      }
      if (generation !== sysGeneration) return;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

      if (generation !== sysGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getVideoTracks().forEach((t) => t.stop()); // we only want the audio
      const tracks = stream.getAudioTracks();
      if (!tracks.length) {
        clarity.log('system audio: no loopback track on this platform');
        stream.getTracks().forEach((t) => t.stop());
        showStatus(clarity.platform === 'win32'
          ? 'No system-audio loopback track detected. Make sure "Share audio" is checked in the screen share dialog, and that your audio device is not in exclusive mode.'
          : 'No system-audio track was returned. In System Settings → Privacy & Security → Screen & System Audio Recording, make sure Clarity is enabled, then restart Clarity. Your microphone can still work without the Them channel.');
        return;
      }
      sysStream = stream;
      tracks.forEach(track => { track.onended = () => {
        if (generation !== sysGeneration) return;
        stopSystemAudio();
        stopMic();
        if ($('#stop-btn').classList.contains('active')) void clarity.captureToggle();
        showStatus('System audio disconnected. Click Play to reconnect meeting audio.');
      }; });
      sysCtx = new AudioContext({ sampleRate: 16000 });
      await sysCtx.resume();
      if (generation !== sysGeneration) return;

      // Use AudioWorklet for system audio too
      try {
        await sysCtx.audioWorklet.addModule('audio-worklet-processor.js');
        if (generation !== sysGeneration) return;
        const source = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        sysWorklet = new AudioWorkletNode(sysCtx, 'clarity-audio-processor', { processorOptions: { maxGain: 4 } });
        sysWorklet.port.onmessage = (e) => {
          clarity.systemPcm(e.data);
        };
        source.connect(sysWorklet);
        sysWorklet.connect(sysCtx.destination);
        clarity.log('system audio: AudioWorklet capturing loopback');
      } catch (workletErr) {
        if (generation !== sysGeneration) return;
        // Fallback to ScriptProcessor
        clarity.log('system audio AudioWorklet failed, using ScriptProcessor: ' + workletErr.message);
        const sysNode = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        const sysProc = sysCtx.createScriptProcessor(4096, Math.max(1, Math.min(2, sysNode.channelCount)), 1);
        const conditioner = new window.ClarityAudio.AudioConditioner(4);
        const sink = sysCtx.createGain(); sink.gain.value = 0;
        sysNode.connect(sysProc); sysProc.connect(sink); sink.connect(sysCtx.destination);
        sysProc.onaudioprocess = (e) => {
          const channels = Array.from({ length: e.inputBuffer.numberOfChannels }, (_, i) => e.inputBuffer.getChannelData(i));
          const f = conditioner.process(window.ClarityAudio.downmixToMono(channels));
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          clarity.systemPcm(out.buffer);
        };
        sysWorklet = { _legacy: true, proc: sysProc, node: sysNode, sink };
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (generation !== sysGeneration) return;
      stopSystemAudio();
      clarity.log('system audio error: ' + message);
      showStatus('Meeting audio could not be started. Grant screen/audio access to Clarity and try again.');
    } finally {
      if (nativePromptActive) await clarity.endSystemAudioPermissionPrompt();
      if (generation === sysGeneration) sysStarting = false;
    }
  }
  function stopSystemAudio() {
    sysGeneration++;
    sysStarting = false;
    if (sysWorklet) {
      if (sysWorklet._legacy) {
        sysWorklet.proc.disconnect(); sysWorklet.proc.onaudioprocess = null;
        sysWorklet.node.disconnect(); sysWorklet.sink.disconnect();
      } else {
        sysWorklet.disconnect();
      }
      sysWorklet = null;
    }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
  }

  // ---- STT / VAD status helpers ------------------------------------------
  // Live dot states: 'off' | 'idle' | 'speaking' | 'transcribing'
  function setLiveDotState(dotState) {
    const dot = document.getElementById('live-dot');
    if (!dot) return;
    dot.classList.remove('off', 'idle', 'speaking', 'transcribing');
    dot.classList.add(dotState);
    const labels = {
      off:          'Not listening',
      idle:         'Listening — silence detected',
      speaking:     'Speech detected',
      transcribing: 'Transcribing…'
    };
    dot.title = labels[dotState] || '';
  }

  let sttState = 'disconnected';

  function updateSttStatus({ active, streaming } = {}) {
    const label = document.getElementById('stt-status');
    if (!label) return;
    if (active === false) {
      sttState = 'disconnected';
      label.textContent = 'off';
    } else if (active === true) {
      sttState = streaming ? 'connecting' : 'batch';
      label.textContent = sttState;
    }
    label.className = 'stt-status stt-' + sttState;
  }

  // ---- transcript history sidebar (hidden by default, manual toggle) ----
  let tsSidebarInterimEl = null;
  let sidebarOpen = false;
  let historyHideTimer = null;
  // Track last committed row per channel — all chunks from same speaker go in one row
  const tsLastRow = { you: null, them: null };
  const tsRowTimer = { you: null, them: null };
  const TS_SENTENCE_GAP_MS = 10000; // 10s silence = new row

  function syncHistorySidebarGeometry() {
    const panel = document.getElementById('panel');
    const sidebar = document.getElementById('transcript-sidebar');
    if (!panel || !sidebar || sidebar.classList.contains('hidden')) return;
    const rect = panel.getBoundingClientRect();
    sidebar.style.setProperty('--history-top', `${Math.round(rect.top)}px`);
    const left = rect.right + 12;
    const fitsRight = left + 240 <= window.innerWidth;
    sidebar.style.setProperty('--history-left', `${Math.round(fitsRight ? left : Math.max(8, rect.right - 240))}px`);
    sidebar.style.setProperty('--history-height', `${Math.round(rect.height)}px`);
  }

  const historyPanel = document.getElementById('panel');
  const historyResizeObserver = historyPanel && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => syncHistorySidebarGeometry())
    : null;
  if (historyResizeObserver) historyResizeObserver.observe(historyPanel);
  window.addEventListener('resize', syncHistorySidebarGeometry);

  function showSidebar() {
    if (sidebarOpen) return;
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (historyHideTimer) {
      clearTimeout(historyHideTimer);
      historyHideTimer = null;
    }
    if (sidebar) {
      sidebar.classList.remove('hidden', 'closing');
      sidebar.setAttribute('aria-hidden', 'false');
    }
    if (historyBtn) {
      historyBtn.classList.add('active');
      historyBtn.setAttribute('aria-expanded', 'true');
      historyBtn.setAttribute('aria-label', 'Hide conversation history');
    }
    sidebarOpen = true;
    syncHistorySidebarGeometry();
    requestAnimationFrame(() => syncHistorySidebarGeometry());
    setIgnore(false);
  }

  function hideSidebar() {
    if (!sidebarOpen) return;
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) {
      historyBtn.classList.remove('active');
      historyBtn.setAttribute('aria-expanded', 'false');
      historyBtn.setAttribute('aria-label', 'Show conversation history');
    }
    sidebarOpen = false;

    if (!sidebar) return;
    if (historyHideTimer) clearTimeout(historyHideTimer);

    const finishHide = () => {
      historyHideTimer = null;
      if (sidebarOpen) return;
      sidebar.classList.remove('closing');
      sidebar.classList.add('hidden');
      sidebar.setAttribute('aria-hidden', 'true');
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishHide();
      return;
    }

    sidebar.classList.add('closing');
    historyHideTimer = setTimeout(finishHide, 230);
  }

  function toggleSidebar() {
    if (sidebarOpen) {
      hideSidebar();
    } else {
      if (panelCollapsed) toggleHide();
      showSidebar();
      // FIX #7: Scroll to bottom when opening sidebar
      const list = document.getElementById('ts-list');
      if (list) {
        requestAnimationFrame(() => {
          list.scrollTop = list.scrollHeight;
        });
      }
    }
  }

  // History button toggle
  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.innerHTML = icon('message-square-text', { size: 15 });
    historyBtn.addEventListener('click', toggleSidebar);
  }

  // Close sidebar button
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', hideSidebar);
  }

  for (const id of ['open-transcripts-btn', 'settings-open-transcripts']) {
    const openTranscriptsBtn = document.getElementById(id);
    if (!openTranscriptsBtn) continue;
    openTranscriptsBtn.addEventListener('click', async () => {
      try {
        const result = await clarity.openTranscriptFolder();
        if (!result?.canceled) showToast('Opened saved transcript', 1800);
      } catch (error) {
        showToast(`Could not open transcripts: ${error.message}`, 3200);
      }
    });
  }

  function appendTranscriptHistoryTurn(channel, text, isInterim) {
    const list = document.getElementById('ts-list');
    if (!list) return;

    // Remove placeholder on first real turn
    const ph = list.querySelector('.ts-placeholder');
    if (ph) ph.remove();

    if (isInterim) {
      // Update the single floating interim row
      if (!tsSidebarInterimEl) {
        tsSidebarInterimEl = document.createElement('div');
        tsSidebarInterimEl.className = 'ts-turn ts-' + channel + ' ts-interim-row';
        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? 'Them' : 'You';
        const txt = document.createElement('span');
        txt.className = 'ts-text ts-interim';
        tsSidebarInterimEl.appendChild(chLabel);
        tsSidebarInterimEl.appendChild(txt);
        list.appendChild(tsSidebarInterimEl);
      }
      tsSidebarInterimEl.querySelector('.ts-text').textContent = text;
    } else {
      // Remove interim row
      if (tsSidebarInterimEl) { tsSidebarInterimEl.remove(); tsSidebarInterimEl = null; }

      const existingRow = tsLastRow[channel];
      const useExisting = existingRow && existingRow.isConnected;

      if (useExisting) {
        // Append to existing row — accumulates sentence fragments
        const txt = existingRow.querySelector('.ts-text');
        if (txt) {
          txt.textContent = txt.textContent ? txt.textContent + ' ' + text : text;
        }
      } else {
        // Start a new row (no buttons — just clean history view)
        const row = document.createElement('div');
        row.className = 'ts-turn ts-' + channel;

        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? 'Them' : 'You';

        const txt = document.createElement('span');
        txt.className = 'ts-text';
        txt.textContent = text;

        row.appendChild(chLabel);
        row.appendChild(txt);
        list.appendChild(row);
        tsLastRow[channel] = row;
      }

      // Reset silence timer
      clearTimeout(tsRowTimer[channel]);
      tsRowTimer[channel] = setTimeout(() => { tsLastRow[channel] = null; }, TS_SENTENCE_GAP_MS);

      // When THIS channel speaks, reset the OTHER channel's row
      const other = channel === 'you' ? 'them' : 'you';
      clearTimeout(tsRowTimer[other]);
      tsLastRow[other] = null;

      transcriptHistoryCount += 1;
      updateHistoryBadge();
      list.scrollTop = list.scrollHeight;
    }
  }

  function clearTranscriptSidebar() {
    const list = document.getElementById('ts-list');
    if (list) list.innerHTML = '<div class="ts-placeholder">Conversation history will appear here when listening.</div>';
    tsSidebarInterimEl = null;
    tsLastRow.you = null; tsLastRow.them = null;
    clearTimeout(tsRowTimer.you); clearTimeout(tsRowTimer.them);
    transcriptHistoryCount = 0;
    updateHistoryBadge();
  }

  // ---- events from main --------------------------------------------------
  clarity.on('capture:state', ({ active, streaming, mode }) => {
    setLiveDotState(active ? 'idle' : 'off');
    updateCaptureButton(active);
    // FIX #4: Add .listening class to composer when capture is active
    composer.classList.toggle('listening', active);
    // Update history button to show active state when listening
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) {
      historyBtn.classList.toggle('listening', active);
    }
    // startSystemAudio() is called directly from the stop-button click handler
    // so that the getDisplayMedia request has a fresh user gesture.
    // Here we only start the mic (no gesture required) and stop everything on deactivate.
    if (active) {
      startMic();
      // Don't auto-open sidebar — user can toggle it manually
    } else {
      stopMic();
      stopSystemAudio();
      // FIX #2: Clear interim element when capture stops
      if (interimEl) {
        interimEl.textContent = '';
        interimEl.classList.remove('show');
      }
      // Don't auto-close sidebar — let user keep it open if they want
    }
    if (active && mode === 'local') {
      sttState = 'local';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = 'local'; label.className = 'stt-status stt-local'; }
    } else {
      updateSttStatus({ active, streaming });
    }
  });

  // ---- real-time transcript display (interim + final) ----
  let interimEl = null;
  function getOrCreateInterimEl() {
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.className = 'interim-transcript';
      // Insert into panel-main (the left column), before the action row
      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(interimEl, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(interimEl);
      } else {
        document.getElementById('panel').appendChild(interimEl);
      }
    }
    return interimEl;
  }
  clarity.on('stt:interim', ({ channel, text }) => {
    setLiveDotState('transcribing');
    const el = getOrCreateInterimEl();
    const label = channel === 'them' ? 'Them' : 'You';
    el.textContent = `${label}: ${text}`;
    el.classList.add('show');
    appendTranscriptHistoryTurn(channel, text, true); // update sidebar interim
  });
  clarity.on('stt:final', ({ channel, text }) => {
    setLiveDotState('idle');
    // Clear interim when we get a final
    if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
    clearTranscriptInterim();
    // sidebar: the final turn is added via the 'transcript' event below
  });
  clarity.on('stt:status', ({ channel, status, provider }) => {
    clarity.log(`[stt] ${provider || channel || 'unknown'} ${status}`);
    if (provider === 'local') {
      const label = document.getElementById('stt-status');
      const localLabels = {
        loading: 'loading local',
        ready: 'local',
        transcribing: 'local',
        stopping: 'stopping',
        off: 'off',
        error: 'error'
      };
      sttState = status === 'ready' || status === 'transcribing' ? 'local' : status;
      if (label) {
        label.textContent = localLabels[status] || status;
        label.className = 'stt-status stt-' + sttState;
      }
      if (status === 'loading') updateCaptureButton(true);
      if (status === 'off' || status === 'error') updateCaptureButton(false);
      if (status === 'loading' || status === 'transcribing' || status === 'stopping') setLiveDotState('transcribing');
      if (status === 'ready') setLiveDotState('idle');
      if (status === 'off') setLiveDotState('off');
      return;
    }
    if (status === 'connected') {
      sttState = 'streaming';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = sttState; label.className = 'stt-status stt-streaming'; }
    }
  });
  clarity.on('vad:state', ({ channel, speaking }) => {
    setLiveDotState(speaking ? 'speaking' : 'idle');
  });
  clarity.on('llm:start', ({ userBubble, small, category }) => {
    messages.classList.remove('start-state');
    const startMessage = messages.querySelector('.start-message');
    if (startMessage) startMessage.remove();
    responseCount++;
    if (responseCount > MAX_RESPONSES) {
      const oldest = messages.querySelector('.response-group');
      if (oldest) oldest.remove();
      responseCount = MAX_RESPONSES;
    }
    const group = document.createElement('div');
    group.className = 'response-group';
    const sep = document.createElement('div');
    sep.className = 'response-sep';
    sep.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.appendChild(sep);
    if (userBubble) {
      const b = document.createElement('div');
      b.className = 'user-bubble';
      b.textContent = userBubble;
      group.appendChild(b);
    }
    if (category) {
      const pill = document.createElement('div');
      pill.className = 'category-pill';
      pill.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      group.appendChild(pill);
    }
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    group.appendChild(aiEl);
    messages.appendChild(group);
    activeResponseGroup = group;
    // Jump to each new answer, then keep following it while text streams.
    requestAnimationFrame(() => scrollResponseIntoView(group, 'smooth'));
    setBusy(true);
  });
  clarity.on('llm:token', ({ text }) => appendToken(text));
  clarity.on('llm:done', ({ stopped } = {}) => {
    finalizeAi();
    if (stopped) showStatus('Response stopped', 1400);
    messages.scrollTo({ top: messages.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setBusy(false);
  });
  clarity.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
  });
  clarity.on('transcript:sync', (turns) => {
    clearTranscriptSidebar();
    for (const turn of turns) appendTranscriptHistoryTurn(turn.channel, turn.text, false);
  });
  clarity.on('transcript', ({ channel, text }) => {
    if (!text || text.trim().length < 2 || /^[?!.,;:\-…]+$/.test(text.trim())) return;
    appendTranscriptHistoryTurn(channel, text, false);
  });
  let statusTimer = null;
  function showStatus(message, ms = 11000) {
    let el = document.getElementById('clarity-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'clarity-status';
      // Insert into panel-main before the action row
      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(el, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(el);
      } else {
        document.getElementById('panel').appendChild(el);
      }
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  clarity.on('status', ({ message }) => {
    clarity.log('[status] ' + message);
    showStatus(message);
    if (sttState !== 'disconnected') {
      const lower = message.toLowerCase();
      if (lower.includes('error') || lower.includes(' off')) {
        sttState = 'error';
        const label = document.getElementById('stt-status');
        if (label) { label.textContent = sttState; label.className = 'stt-status stt-error'; }
      }
    }
  });

  // ---- prep status & smart tooltip helpers -------------------------------


  // ---- AI rules: live char counter + soft cap ---------------------------
  function updateAiRulesCounter() {
    const el = document.getElementById('ai-rules');
    const counter = document.getElementById('ai-rules-count');
    if (!el || !counter) return;
    const n = el.value.length;
    const cap = 2000;
    counter.textContent = String(n);
    counter.classList.toggle('over', n >= cap);
    counter.parentElement.classList.toggle('s-counter-warn', n >= cap - 100);
  }
  const aiRulesEl = document.getElementById('ai-rules');
  if (aiRulesEl) aiRulesEl.addEventListener('input', updateAiRulesCounter);
  function updatePrepStatus() {
    if (!settings) return;
    const fields = {
      resume:  !!(settings.resumeText && settings.resumeText.trim()),
      jd:      !!(settings.jobDescription && settings.jobDescription.trim()),
      stories: !!(settings.starStories && settings.starStories.trim()),
      salary:  !!(settings.salaryTarget && settings.salaryTarget.trim())
    };
    document.querySelectorAll('#prep-status .prep-item').forEach((el) => {
      const loaded = fields[el.dataset.field];
      el.classList.toggle('loaded', loaded);
      el.classList.toggle('missing', !loaded);
      el.title = loaded
        ? el.textContent.trim() + ' loaded'
        : el.textContent.trim() + ' not set — add in Settings';
    });
    document.querySelectorAll('#prep-readiness .prep-context-item').forEach((el) => {
      const loaded = fields[el.dataset.field];
      el.classList.toggle('loaded', loaded);
      el.classList.toggle('missing', !loaded);
    });
  }

  function updateSmartTooltip() {
    if (!settings) return;
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    const fast = m.fast || 'fast model';
    const smart = m.smart || 'smart model';
    const btn = document.getElementById('smart-toggle');
    if (btn) btn.title = 'Fast: ' + fast + ' · Smart: ' + smart + ' (higher quality, ~2× slower)';
  }

  // ---- microphone permission banner --------------------------------------
  function showMicPermissionBanner() {
    let banner = document.getElementById('mic-perm-banner');
    if (banner) { banner.classList.add('show'); return; }
    banner = document.createElement('div');
    banner.id = 'mic-perm-banner';
    banner.className = 'show';
    banner.innerHTML =
      '<div class="mic-perm-text">' +
        '<strong>Microphone access required</strong><br>' +
        'Clarity needs microphone permission to hear you during calls. Grant access in System Settings, then restart Clarity.' +
      '</div>' +
      '<div class="mic-perm-actions"></div>';
    const actions = banner.querySelector('.mic-perm-actions');
    if (clarity.platform === 'darwin') {
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open Microphone Settings';
      openBtn.addEventListener('click', () => clarity.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'));
      actions.appendChild(openBtn);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.className = 'dismiss';
    dismissBtn.addEventListener('click', () => banner.classList.remove('show'));
    actions.appendChild(dismissBtn);
    const panel = document.getElementById('panel');
    panel.insertBefore(banner, document.getElementById('action-row'));
  }

  // ---- settings ----------------------------------------------------------
  const scrim = $('#settings-scrim');
  let settingsHideTimer = null;
  let settingsReturnFocus = null;
  function openSettings(requestedTab = 'keys') {
    if (!settings) return;
    const targetTab = typeof requestedTab === 'string' ? requestedTab : 'keys';
    if (!scrim.classList.contains('hidden') && !scrim.classList.contains('closing')) {
      activateSettingsTab(targetTab);
      return;
    }
    // A settings sheet can be opened from a global shortcut while the window is
    // currently click-through. Make it interactive immediately rather than
    // requiring a mousemove before any control can be clicked.
    setIgnore(false);
    if (settingsHideTimer) {
      clearTimeout(settingsHideTimer);
      settingsHideTimer = null;
    }
    settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const tutorialScrim = $('#onboard-scrim');
    const tutorialIsOpen = tutorialScrim && !tutorialScrim.classList.contains('hidden');
    tutorialScrim?.classList.toggle('settings-underlay', tutorialIsOpen);
    if (tutorialIsOpen) tutorialScrim.setAttribute('aria-hidden', 'true');
    clarity.setSettingsPriority(true);
    fillSettings();
    activateSettingsTab(targetTab);
    scrim.classList.remove('hidden', 'closing');
    refreshWhisperModels();
    requestAnimationFrame(() => document.querySelector(`.s-tab[data-tab="${targetTab}"]`)?.focus());
  }
  async function closeSettings() {
    if (scrim.classList.contains('hidden') || scrim.classList.contains('closing')) return;
    if (!(await saveSettings())) return;

    const finishClose = () => {
      settingsHideTimer = null;
      scrim.classList.remove('closing');
      scrim.classList.add('hidden');
      clarity.setSettingsPriority(false);
      const tutorialScrim = $('#onboard-scrim');
      tutorialScrim?.classList.remove('settings-underlay');
      tutorialScrim?.removeAttribute('aria-hidden');
      if (settingsReturnFocus && document.contains(settingsReturnFocus)) settingsReturnFocus.focus();
      settingsReturnFocus = null;
    };

    scrim.classList.add('closing');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }
    settingsHideTimer = setTimeout(finishClose, 170);
  }
  $('#more-btn').addEventListener('click', openSettings);
  $('#toolbar-settings-btn').addEventListener('click', openSettings);
  clarity.on('settings:open', openSettings);
  $('#s-close').addEventListener('click', () => { void closeSettings(); });
  scrim.addEventListener('click', (e) => { if (e.target === scrim) void closeSettings(); });
  scrim.addEventListener('cancel', (e) => { e.preventDefault(); void closeSettings(); });

  function activateSettingsTab(name) {
    const tab = document.querySelector(`.s-tab[data-tab="${name}"]`);
    const pane = document.querySelector(`.s-tab-pane[data-pane="${name}"]`);
    if (!tab || !pane) return;
    document.querySelectorAll('.s-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('on', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.s-tab-pane').forEach((item) => {
      const active = item === pane;
      item.classList.toggle('hidden', !active);
      item.setAttribute('aria-hidden', String(!active));
    });
    pane.scrollTop = 0;
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Tab switching is navigation only. Saving/validation happens when Settings closes.
  document.querySelectorAll('.s-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activateSettingsTab(tab.dataset.tab);
    });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.s-tab'));
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      activateSettingsTab(tabs[next].dataset.tab);
      tabs[next].focus();
    });
  });

  function updateCustomProviderFields() {
    $('#custom-endpoint-settings').classList.toggle('hidden', settings.provider !== 'custom');
  }

  function fillSettings() {
    // Keys tab
    document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    $('#key-deepgram').value = settings.apiKeys.deepgram || '';
    $('#key-custom').value = settings.apiKeys.custom || '';
    $('#base-url').value = settings.baseUrl || '';
    updateCustomProviderFields();
    $('#key-ollama').value = settings.apiKeys.ollama || '';
    $('#key-groq').value = settings.apiKeys.groq || '';
    $('#key-minimax').value = settings.apiKeys.minimax || '';
    document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.classList.toggle('on', b.dataset.region === (settings.minimaxRegion || 'global_en')));
    $('#key-azure').value = settings.apiKeys.azure || '';
    $('#azure-endpoint').value = settings.azureEndpoint || '';
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    fillAppLinkCallers();
    $('#s-status').textContent = statusText();
    // Transcription tab
    document.querySelectorAll('#stt-provider-seg button').forEach((button) => {
      button.classList.toggle('on', button.dataset.sttProvider === (settings.sttProvider || 'auto'));
    });
    const localWhisper = settings.localWhisper || { modelId: 'small.en', language: 'auto', threads: 0 };
    $('#whisper-language').value = localWhisper.language || 'auto';
    $('#whisper-threads').value = Number(localWhisper.threads) || 0;
    $('#save-transcripts-toggle').checked = !!settings.saveTranscripts;
    // Profile tab
    $('#resume-text').value = settings.resumeText || '';
    $('#job-description').value = settings.jobDescription || '';
    // Interview Prep tab
    $('#star-stories').value = settings.starStories || '';
    $('#why-company').value = settings.whyCompany || '';
    $('#why-leaving').value = settings.whyLeaving || '';
    $('#work-style').value = settings.workStyle || '';
    $('#live-answer-toggle').checked = !!settings.liveAnswerSuggestions;
    // Style tab
    $('#ai-rules').value = settings.aiRules || '';
    updateAiRulesCounter();
    // Q&A tab
    $('#salary-target').value = settings.salaryTarget || '';
    $('#questions-to-ask').value = settings.questionsToAsk || '';
  }

  // Whoever Clarity has been told it may answer questions for. Empty is the normal
  // state — nothing appears here until something has asked and been allowed.
  async function fillAppLinkCallers() {
    const host = $('#applink-callers');
    if (!host || !clarity.appLinkState) return;
    let state;
    try { state = await clarity.appLinkState(); } catch (_) { return; }
    const callers = Object.entries((state && state.callers) || {});
    if (!callers.length) {
      host.innerHTML = '<div class="s-caller-empty">Nothing has asked yet.</div>';
      return;
    }
    host.innerHTML = '';
    for (const [id, scopes] of callers) {
      const allowed = Object.entries(scopes)
        .filter(([, record]) => record && record.decision === 'granted')
        .map(([scope]) => (scope === 'action' ? 'control' : 'read'));
      const name = (scopes.read && scopes.read.callerName) || (scopes.action && scopes.action.callerName) || id;

      const row = document.createElement('div');
      row.className = 's-caller';
      const label = document.createElement('span');
      label.textContent = name + ' — ' + (allowed.length ? allowed.join(' + ') : 'denied');
      label.title = id;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Forget';
      button.addEventListener('click', async () => {
        await clarity.appLinkRevoke(id);
        fillAppLinkCallers();
      });
      row.append(label, button);
      host.append(row);
    }
  }

  const uploadResumeBtn = document.getElementById('upload-resume-btn');
  if (uploadResumeBtn) uploadResumeBtn.addEventListener('click', async () => {
    const res = await clarity.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('Resume import failed: ' + res.error); return; }
    $('#resume-text').value = res.text || '';
    showStatus('Imported ' + res.fileName + ' — close Settings to save it.');
  });
  const uploadJdBtn = document.getElementById('upload-jd-btn');
  if (uploadJdBtn) uploadJdBtn.addEventListener('click', async () => {
    const res = await clarity.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('Job description import failed: ' + res.error); return; }
    $('#job-description').value = res.text || '';
    showStatus('Imported ' + res.fileName + ' — close Settings to save it.');
  });

  function statusText() {
    const k = settings.apiKeys;
    const labels = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepgram: 'Deepgram', custom: 'Custom', ollama: 'Ollama', groq: 'Groq', minimax: 'MiniMax', azure: 'Azure AI Foundry' };
    const has = Object.keys(labels).filter((p) => k[p]).map((p) => labels[p]);
    // 'auto' walks the same fallback chain src/stt.js builds; an explicit choice
    // is reported as-is so the status line matches what will actually be used.
    const selectedSttProvider = settings.sttProvider || 'auto';
    const automaticStt = k.deepgram ? 'Deepgram (streaming)' : (k.openai ? 'OpenAI Realtime' : (k.groq ? 'Groq Whisper' : (k.gemini ? 'Gemini (batch)' : 'none')));
    const stt = selectedSttProvider === 'auto' ? automaticStt : selectedSttProvider;
    const ready = [
      settings.resumeText ? 'resume ready' : null,
      settings.jobDescription ? 'JD ready' : null,
      settings.starStories ? 'stories ready' : null,
      settings.salaryTarget ? 'salary ready' : null
    ].filter(Boolean);
    return `${labels[settings.provider] || settings.provider} · STT: ${stt}` + (ready.length ? ' · ' + ready.join(' · ') : '');
  }

  document.querySelectorAll('#provider-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.provider = b.dataset.provider;
    document.querySelectorAll('#provider-seg button').forEach((x) => x.classList.toggle('on', x === b));
    updateCustomProviderFields();
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#s-status').textContent = statusText();
    updateSmartTooltip();
  }));
  document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.minimaxRegion = b.dataset.region;
    document.querySelectorAll('#minimax-region-seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  document.querySelectorAll('#stt-provider-seg button').forEach((button) => button.addEventListener('click', () => {
    settings.sttProvider = button.dataset.sttProvider;
    document.querySelectorAll('#stt-provider-seg button').forEach((candidate) => {
      candidate.classList.toggle('on', candidate === button);
    });
    $('#s-status').textContent = statusText();
  }));

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** unitIndex);
    return `${value >= 10 || unitIndex < 2 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function getSelectedWhisperModel() {
    if (!whisperOverview) return null;
    return whisperOverview.models.find((model) => model.id === $('#whisper-model').value) || null;
  }

  function renderWhisperModelState() {
    const model = getSelectedWhisperModel();
    if (!model) return;
    const language = model.englishOnly ? 'English only' : 'Multilingual';
    const recommendation = model.recommended ? ' · recommended default' : '';
    const partial = model.partialBytes > 0 && !model.installed
      ? ` · ${formatBytes(model.partialBytes)} ready to resume`
      : '';
    $('#whisper-model-detail').textContent = `${formatBytes(model.bytes)} · ${language} · ${model.quantization} · ${model.hardwareTier}${recommendation}${partial}`;

    const progressWrap = $('#whisper-progress-wrap');
    const progressPercent = model.bytes > 0 ? Math.floor((model.partialBytes / model.bytes) * 100) : 0;
    progressWrap.classList.toggle('hidden', !model.downloading);
    $('#whisper-progress').value = progressPercent;
    $('#whisper-progress-label').textContent = `${progressPercent}%`;
    $('#whisper-download').disabled = model.installed || model.downloading;
    $('#whisper-download').textContent = model.installed ? 'Installed' : (model.partialBytes ? 'Resume' : 'Download');
    $('#whisper-cancel').classList.toggle('hidden', !model.downloading);
    $('#whisper-import').disabled = model.downloading;
    $('#whisper-delete').disabled = (model.installedBytes === 0 && model.partialBytes === 0) || model.downloading;
  }

  async function refreshWhisperModels() {
    const status = $('#whisper-status');
    try {
      const previousSelection = $('#whisper-model').value || settings.localWhisper?.modelId || 'small.en';
      whisperOverview = await clarity.whisperModels();
      const runtimeBadge = $('#whisper-runtime-status');
      runtimeBadge.classList.toggle('ready', whisperOverview.runtime.available);
      runtimeBadge.classList.toggle('error', !whisperOverview.runtime.available);
      runtimeBadge.textContent = whisperOverview.runtime.available
        ? `Ready · v${whisperOverview.runtime.version} · ${whisperOverview.runtime.target}`
        : 'Not prepared';
      runtimeBadge.title = whisperOverview.runtime.message || '';

      const select = $('#whisper-model');
      select.innerHTML = '';
      for (const model of whisperOverview.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.label} — ${formatBytes(model.bytes)}${model.recommended ? ' (recommended)' : ''}${model.installed ? ' (installed)' : ''}`;
        select.appendChild(option);
      }
      const selectionExists = whisperOverview.models.some((model) => model.id === previousSelection);
      select.value = selectionExists ? previousSelection : 'small.en';
      if (!settings.localWhisper) settings.localWhisper = {};
      settings.localWhisper.modelId = select.value;
      status.textContent = whisperOverview.runtime.available
        ? 'Model files are verified before they can be loaded.'
        : whisperOverview.runtime.message;
      renderWhisperModelState();
    } catch (error) {
      status.textContent = `Could not load local model information: ${error.message}`;
    }
  }

  $('#whisper-model').addEventListener('change', () => {
    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value;
    renderWhisperModelState();
  });

  $('#whisper-download').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model) return;
    model.downloading = true;
    renderWhisperModelState();
    $('#whisper-status').textContent = `Downloading ${model.id}. You can cancel and resume later.`;
    try {
      await clarity.whisperModelDownload(model.id);
      $('#whisper-status').textContent = `${model.id} downloaded and verified.`;
    } catch (error) {
      $('#whisper-status').textContent = error.message.includes('cancelled')
        ? `${model.id} download paused. Progress was kept.`
        : `Download failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  $('#whisper-cancel').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (model) await clarity.whisperModelCancel(model.id);
  });

  $('#whisper-import').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model) return;
    $('#whisper-status').textContent = `Verifying imported ${model.id}…`;
    try {
      const result = await clarity.whisperModelImport(model.id);
      $('#whisper-status').textContent = result.cancelled ? 'Import cancelled.' : `${model.id} imported and verified.`;
    } catch (error) {
      $('#whisper-status').textContent = `Import failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  $('#whisper-delete').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model || !window.confirm(`Delete the ${model.id} model (${formatBytes(model.bytes)}) from this computer?`)) return;
    try {
      await clarity.whisperModelDelete(model.id);
      $('#whisper-status').textContent = `${model.id} deleted.`;
    } catch (error) {
      $('#whisper-status').textContent = `Delete failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  clarity.on('whisper:download-progress', (progress) => {
    if (!whisperOverview) return;
    const model = whisperOverview.models.find((candidate) => candidate.id === progress.modelId);
    if (!model) return;
    model.partialBytes = progress.receivedBytes;
    model.downloading = true;
    if ($('#whisper-model').value === progress.modelId) {
      $('#whisper-progress-wrap').classList.remove('hidden');
      $('#whisper-progress').value = progress.percent;
      $('#whisper-progress-label').textContent = `${progress.percent}%`;
      $('#whisper-model-detail').textContent = `${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)}`;
    }
  });
  clarity.on('whisper:models-changed', () => refreshWhisperModels());

  async function saveSettings() {
    // Keys
    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    settings.apiKeys.deepgram = $('#key-deepgram').value.trim();
    settings.apiKeys.custom = $('#key-custom').value.trim();
    settings.baseUrl = $('#base-url').value.trim();
    settings.apiKeys.ollama = $('#key-ollama').value.trim();
    settings.apiKeys.groq = $('#key-groq').value.trim();
    settings.apiKeys.minimax = $('#key-minimax').value.trim();
    settings.apiKeys.azure = $('#key-azure').value.trim();
    settings.azureEndpoint = $('#azure-endpoint').value.trim();
    if (!settings.models[settings.provider]) settings.models[settings.provider] = {};
    settings.models[settings.provider].fast = $('#model-fast').value.trim();
    settings.models[settings.provider].smart = $('#model-smart').value.trim();
    // Transcription
    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value || settings.localWhisper.modelId || 'small.en';
    settings.localWhisper.language = $('#whisper-language').value || 'auto';
    settings.localWhisper.threads = Math.max(0, Math.min(64, Number.parseInt($('#whisper-threads').value, 10) || 0));
    settings.saveTranscripts = !!$('#save-transcripts-toggle').checked;
    // Profile
    settings.resumeText = $('#resume-text').value.trim();
    settings.jobDescription = $('#job-description').value.trim();
    // Interview Prep
    settings.starStories = $('#star-stories').value.trim();
    settings.whyCompany = $('#why-company').value.trim();
    settings.whyLeaving = $('#why-leaving').value.trim();
    settings.workStyle = $('#work-style').value.trim();
    settings.liveAnswerSuggestions = !!$('#live-answer-toggle').checked;
    // Style tab
    settings.aiRules = $('#ai-rules').value.trim();
    // Q&A
    settings.salaryTarget = $('#salary-target').value.trim();
    settings.questionsToAsk = $('#questions-to-ask').value.trim();
    try {
      const { windowX, windowY, ...editableSettings } = settings;
      settings = await clarity.settingsSet(editableSettings);
      $('#s-status').textContent = statusText();
      updatePrepStatus();
      updateSmartTooltip();
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      $('#s-status').textContent = message;
      $('#base-url').focus();
      return false;
    }
  }

  // ---- startup state -------------------------------------------------------
  function showStartMessage() {
    clearMessages();
    messages.classList.add('start-state');
    const start = document.createElement('div');
    start.className = 'start-message';

    const title = document.createElement('div');
    title.className = 'start-message-title';
    title.textContent = 'Ready when you are';

    const body = document.createElement('div');
    body.className = 'start-message-body';
    body.textContent = 'Press ▶ to start listening, or type a question below.';

    start.appendChild(title);
    start.appendChild(body);
    messages.appendChild(start);
  }

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closeSettings();
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  });

  // Explicit pointer capture keeps the Drag pill usable with any panel open.
  let dragPointer = null;
  const dragPill = document.querySelector('.drag-pill');
  dragPill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || dragPointer !== null) return;
    event.preventDefault();
    dragPointer = event.pointerId;
    dragPill.setPointerCapture(dragPointer);
    setIgnore(false);
    clarity.dragWindow('start');
  });
  dragPill.addEventListener('pointermove', (event) => {
    if (event.pointerId === dragPointer) clarity.dragWindow('move');
  });
  const endWindowDrag = () => {
    if (dragPointer === null) return;
    const id = dragPointer;
    dragPointer = null;
    clarity.dragWindow('end');
    if (dragPill.hasPointerCapture(id)) dragPill.releasePointerCapture(id);
  };
  dragPill.addEventListener('pointerup', endWindowDrag);
  dragPill.addEventListener('pointercancel', endWindowDrag);
  dragPill.addEventListener('lostpointercapture', endWindowDrag);
  window.addEventListener('blur', endWindowDrag);

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) {
    if (v === ignoring) return;
    ignoring = v;
    const toolbar = document.getElementById('toolbar').getBoundingClientRect();
    clarity.setIgnoreMouse(v, { x: toolbar.x, y: toolbar.y, width: toolbar.width, height: toolbar.height });
  }
  clarity.on('mouse:interactive', () => { ignoring = false; });
  document.addEventListener('mousemove', (e) => {
    if (dragPointer !== null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap, #transcript-sidebar, #settings-scrim, #onboard-scrim, #consent-scrim'));
    setIgnore(!overUI);
  });
  // Start interactive so the first click after launch always works. Empty
  // regions become click-through on the first mousemove outside the UI.
  setIgnore(false);

  // ---- assistant access request ------------------------------------------
  // Shown here rather than as a native dialog because Clarity hides its dock icon:
  // an OS panel from an accessory app never comes forward and cannot be
  // clicked. Note the scrim is registered in the click-through selector above
  // and in styles.css — without both, this window stays transparent to the
  // mouse and the buttons do nothing.
  const consentScrim = $('#consent-scrim');
  let pendingConsentId = null;
  let consentHideTimer = null;

  function answerConsent(allowed) {
    if (!pendingConsentId) return;
    clarity.appLinkConsentRespond(pendingConsentId, allowed);
    pendingConsentId = null;
    const finishHide = () => {
      consentHideTimer = null;
      consentScrim.classList.remove('closing');
      consentScrim.classList.add('hidden');
    };
    consentScrim.classList.add('closing');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishHide();
      return;
    }
    consentHideTimer = setTimeout(finishHide, 170);
  }

  clarity.on('applink:consent-request', (request) => {
    if (consentHideTimer) {
      clearTimeout(consentHideTimer);
      consentHideTimer = null;
    }
    pendingConsentId = request.id;
    $('#cs-title').textContent = request.message;
    $('#cs-body').textContent = request.detail;
    $('#cs-allow').textContent = request.allowLabel;
    consentScrim.classList.remove('hidden', 'closing');
    // Do not wait for a mousemove to turn the mouse back on: the pointer may
    // already be still, and the sheet would be unclickable until it moved.
    setIgnore(false);
    $('#cs-deny').focus();
  });

  $('#cs-allow').addEventListener('click', () => answerConsent(true));
  $('#cs-deny').addEventListener('click', () => answerConsent(false));
  // Anything other than a deliberate Allow is a no, including Escape and
  // clicking away.
  consentScrim.addEventListener('click', (e) => { if (e.target === consentScrim) answerConsent(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pendingConsentId) { e.preventDefault(); answerConsent(false); }
  });

  // ---- onboarding / first-run tutorial -----------------------------------
  const obScrim = $('#onboard-scrim');
  let onboardHideTimer = null;
  const permissionHelp = isWindows
    ? 'Clarity needs permission to see and hear. Open Windows Privacy & security settings, allow <strong>Microphone</strong> and <strong>Screen recording</strong> for Clarity, then come back here.'
    : 'Clarity needs two macOS permissions. Choose <strong>Allow Microphone</strong> to show the macOS permission dialog. If previously denied, this opens Microphone settings instead.<br><br>For <strong>Screen & System Audio Recording</strong>, open macOS <strong>System Settings → Privacy & Security → Screen & System Audio Recording</strong>, turn on <strong>Clarity</strong>, then press <strong>⌘⇧/</strong> to return here without a Dock icon. If Clarity is missing, use <strong>+</strong> to add it from Applications. Choose <strong>Check Access</strong> after returning, or <strong>Restart Clarity</strong> if macOS still reports access as off.';
  const permissionButtons = isWindows
    ? [
        { label: 'Open Microphone settings', action: () => clarity.openPane('ms-settings:privacy-microphone') },
        { label: 'Open Screen recording settings', action: () => clarity.openPane('ms-settings:privacy-screenrecorder') }
      ]
    : [
        { label: 'Allow Microphone', action: async () => {
          const status = await clarity.requestMicrophoneAccess();
          showToast(status.mic === 'granted' ? 'Microphone access granted' : 'Allow Clarity in Microphone settings, then return with ⌘⇧/.');
        } },
        { label: 'Open Screen & Audio settings', action: () => clarity.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') },
        { label: 'Restart Clarity', action: () => clarity.restartApp() },
        { label: 'Check Screen & Audio access', feedback: true, action: async (button, feedback) => {
          feedback.hidden = false;
          feedback.className = 'ob-access-result';
          feedback.textContent = 'Checking screen & system audio access…';
          const result = await clarity.permissionsCheck();
          if (!button.isConnected) return;
          const granted = result?.screen === 'granted';
          feedback.classList.add(granted ? 'granted' : 'denied');
          feedback.textContent = granted
            ? 'Screen & system audio access is granted.'
            : 'Access is off. Enable Clarity in Screen & System Audio Recording, then check again. If already enabled, restart Clarity.';
          feedback.scrollIntoView({ block: 'nearest' });
        } }
      ];
  const assistShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">↵</span>' : '<span class="kbd">⌘</span> <span class="kbd">↵</span>';
  const sayShortcut = isWindows ? '<span class="kbd">Ctrl</span><span class="kbd">⇧</span> <span class="kbd">↵</span>' : '<span class="kbd">⌘</span><span class="kbd">⇧</span> <span class="kbd">↵</span>';
  const solveShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">H</span>' : '<span class="kbd">⌘</span> <span class="kbd">H</span>';
  const followupShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">J</span>' : '<span class="kbd">⌘</span> <span class="kbd">J</span>';
  const recapShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">K</span>' : '<span class="kbd">⌘</span> <span class="kbd">K</span>';
  const quitShortcut = isWindows ? '<span class="kbd">Ctrl</span><span class="kbd">⇧</span><span class="kbd">X</span>' : '<span class="kbd">⌘</span><span class="kbd">⇧</span><span class="kbd">X</span>';
  const OB_STEPS = [
    {
      title: 'Welcome to Clarity',
      body: 'Clarity is a private AI copilot that floats over your screen. It can <strong>see your screen</strong>, <strong>hear your meetings</strong>, and help you answer questions or solve coding problems — while staying hidden from most screen shares.<br><br>This quick guide gets you running in about a minute.'
    },
    {
      title: 'Allow Clarity to see & hear',
      body: permissionHelp,
      buttons: permissionButtons
    },
    {
      title: 'Connect an AI provider',
      body: 'Clarity uses <strong>your own</strong> AI provider for answers. Pick <span class="hl">OpenAI</span>, <span class="hl">Anthropic</span>, <span class="hl">Google Gemini</span>, <span class="hl">Azure AI Foundry</span>, or an OpenAI-compatible provider such as <span class="hl">OpenRouter</span>, then enter the provider settings in Clarity.<br><br>Your answer model and your speech-to-text provider are configured separately, so the next step sets up listening.',
      buttons: [{ label: 'Open Clarity Settings', action: openSettings }]
    },
    {
      title: 'Install speech-to-text',
      body: 'Listening needs a speech-to-text engine in addition to your answer model.<br><br><strong>Recommended private setup:</strong> open <span class="hl">Settings → Audio</span>, choose <strong>Local</strong>, select <strong>small.en</strong>, and click <strong>Download</strong>. It is a better accuracy/speed balance for real meetings than base.en. Wait until the model shows as installed before pressing Play.<br><br>You can instead choose <strong>Auto</strong>, <strong>Deepgram</strong>, <strong>OpenAI</strong>, or <strong>Gemini</strong> and provide the matching key. OpenRouter/Custom powers answers only; it does not transcribe speech.',
      buttons: [{ label: 'Open Audio Settings', action: () => openSettings('transcription') }]
    },
    {
      title: 'Stay hidden in Zoom',
      body: 'Clarity requests exclusion from screen shares automatically. This is best-effort: some capture tools and newer macOS versions can still include it. <strong>Zoom needs one setting:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong><br><br>Avoid “<strong>without</strong> window filtering” — that mode reveals Clarity.'
    },
    {
      title: 'You’re all set',
      body: 'How to use Clarity:<ul><li>' + sayShortcut + ' — <strong>What to Say</strong></li><li>' + assistShortcut + ' — <strong>Assist</strong> with whatever\'s on screen or being said</li><li>' + solveShortcut + ' — <strong>Solve Code</strong></li><li>' + followupShortcut + ' — <strong>Follow-up</strong></li><li>' + recapShortcut + ' — <strong>Recap</strong></li><li>⌘, — <strong>Settings</strong></li><li>⌘⇧/ — <strong>Hide / Show</strong></li><li>⌘+ / ⌘− — <strong>Zoom in / out</strong></li><li>⌘0 — <strong>Reset zoom to 100%</strong></li><li>Click <strong>Play</strong> in the top bar to start listening to a meeting</li><li>Type a question and press <span class="kbd">↵</span></li></ul>Reopen this guide anytime with the <strong>Help</strong> button. Quit with ' + quitShortcut + '.'
    }
  ];
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    const stage = $('#ob-stage');
    $('#ob-logo').innerHTML = icon('circle-help', { size: 20 });
    $('#ob-step').textContent = `Step ${obIndex + 1} of ${OB_STEPS.length}`;
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = step.body;
    const btns = $('#ob-buttons'); btns.innerHTML = '';
    (step.buttons || []).forEach((b) => {
      const el = document.createElement('button'); el.textContent = b.label;
      const feedback = b.feedback ? document.createElement('div') : null;
      if (feedback) {
        feedback.className = 'ob-access-result'; feedback.hidden = true;
        feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
        const group = document.createElement('div'); group.className = 'ob-check-group';
        group.append(el, feedback); btns.appendChild(group);
      } else btns.appendChild(el);
      el.addEventListener('click', async () => {
        if (el.disabled) return;
        el.disabled = true;
        try { await b.action(el, feedback); }
        catch (error) {
          if (feedback && el.isConnected) {
            feedback.hidden = false; feedback.className = 'ob-access-result denied';
            feedback.textContent = 'The access check failed. Try again.';
          } else if (el.isConnected) showToast('Could not complete this action. Please try again.');
          clarity.log(String(error));
        }
        finally { el.disabled = false; }
      });
    });
    const dots = $('#ob-dots'); dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => { const d = document.createElement('span'); if (i === obIndex) d.className = 'on'; dots.appendChild(d); });
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? 'Done' : 'Next';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
    stage.scrollTop = 0;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      stage.classList.remove('step-in');
      void stage.offsetWidth;
      stage.classList.add('step-in');
    }
  }
  function showOnboard() {
    if (onboardHideTimer) {
      clearTimeout(onboardHideTimer);
      onboardHideTimer = null;
    }
    obIndex = 0;
    renderOnboard();
    obScrim.classList.remove('hidden', 'closing', 'settings-underlay');
    obScrim.removeAttribute('aria-hidden');
    setIgnore(false);
    requestAnimationFrame(() => $('#ob-next')?.focus());
  }
  async function finishOnboard() {
    const finishHide = () => {
      onboardHideTimer = null;
      obScrim.classList.remove('closing');
      obScrim.classList.add('hidden');
    };
    obScrim.classList.add('closing');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finishHide();
    else onboardHideTimer = setTimeout(finishHide, 170);
    if (settings && !settings.onboarded) { settings.onboarded = true; await clarity.settingsSet({ onboarded: true }); }
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#ob-quit').addEventListener('click', () => clarity.quit());
  $('#logo-btn').addEventListener('click', showOnboard);

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    settings = await clarity.settingsGet();
    const platformInfo = await clarity.platformInfo();

    // R4: shortcut hints
    const sayHintEl = document.getElementById('say-shortcut-hint');
    const assistHintEl = document.getElementById('assist-shortcut-hint');
    const leetcodeHintEl = document.getElementById('leetcode-shortcut-hint');
    const followupHintEl = document.getElementById('followup-shortcut-hint');
    const recapHintEl = document.getElementById('recap-shortcut-hint');
    if (sayHintEl) sayHintEl.textContent = isWindows ? 'Ctrl+Shift+↵' : '⌘⇧↵';
    if (assistHintEl) assistHintEl.textContent = isWindows ? 'Ctrl+↵' : '⌘↵';
    if (leetcodeHintEl) leetcodeHintEl.textContent = isWindows ? 'Ctrl+H' : '⌘H';
    if (followupHintEl) followupHintEl.textContent = isWindows ? 'Ctrl+J' : '⌘J';
    if (recapHintEl) recapHintEl.textContent = isWindows ? 'Ctrl+K' : '⌘K';

    // R5: prep status
    updatePrepStatus();
    // R6: smart tooltip
    updateSmartTooltip();
    // Fix 3: Adjust permission buttons based on actual Windows version.
    // ms-settings:privacy-screenrecorder only exists on Windows 11.
    // On Windows 10, screen capture needs no permission — so replace the button
    // with a more helpful note instead of an invalid settings link.
    if (isWindows && platformInfo.winBuild > 0 && platformInfo.winBuild < 22000) {
      // Windows 10: update the onboarding screen recording button to be more helpful
      const ob = OB_STEPS[1];
      ob.buttons = ob.buttons.filter((b) => !b.label.toLowerCase().includes('screen'));
      ob.body = 'Clarity needs microphone permission to hear you. Click the button below to open Windows microphone settings and allow Clarity.<br><br><strong>Screen capture works automatically on Windows 10</strong> — no additional permission needed.<ul><li><strong>Microphone</strong> — to hear you</li><li><strong>Screen recording</strong> — works automatically on Windows 10</li></ul>';
    }

    smartBtn.classList.toggle('on', !!settings.smart);
    smartBtn.setAttribute('aria-pressed', String(!!settings.smart));
    showStartMessage();
    syncPlaceholder();
    updateHistoryBadge(); // FIX #3: Initialize badge on boot
    updateSendButtonState(); // Initialize send button state

    // Fix placeholder shortcut hint to match platform
    if (isWindows) {
      placeholder.innerHTML = 'Ask about your screen or conversation, or <span class="keycap">Ctrl</span><span class="keycap">⏎</span> for Assist';
    }

    const st = await clarity.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    updateCaptureButton(st.active);
    if (!settings.onboarded) showOnboard();
  })();
})();
