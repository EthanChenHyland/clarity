const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, dialog, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const PRODUCT_NAME = 'Clarity';
app.setName(PRODUCT_NAME);
if (process.platform === 'win32') {
  process.title = PRODUCT_NAME;
  app.setAppUserModelId('com.clarity.overlay');
}
const store = require('./src/store');
const { abortable } = require('./src/abortable');
const { nextZoomFactor } = require('./src/ui-zoom');
const { captureScreenshot } = require('./src/screen');
const { createSTT, buildVocabPrompt } = require('./src/stt');
const { parseDocumentFile } = require('./src/resume');
const { createLLM } = require('./src/llm');
const { streamWithSmartFallback } = require('./src/live-answer-stream');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { createStreamingSTT } = require('./src/stt-streaming');
const { AdaptiveVAD, AudioRingBuffer } = require('./src/vad');
const { buildInterviewContext, detectCategory } = require('./src/interview-context');
const {
  isLikelyInterviewQuestion,
  collectRecentInterviewerQuestion,
  questionsEquivalent,
  shouldReplaceLiveAnswerQuestion,
  isLikelyTranscriptEcho
} = require('./src/live-answer');
const { startAppLink, stopAppLink, recordEvent, appLinkConsentState, revokeAppLinkCaller } = require('./src/applink');
const { createTranscriptArchive } = require('./src/transcript-archive');
const { ResourceContextIndex, appendResourceContext } = require('./src/resource-context');

// Electron 44 defaults to CoreAudio Tap, which uses a separate audio-only
// permission. Keep capture on ScreenCaptureKit so the permission users grant
// in our screen-and-audio setup is also the permission used by normal Play.
// This compatibility switch must be revisited before upgrading to Electron 45.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
}
const { WhisperModelManager } = require('./src/whisper-model-manager');
const { requireWhisperModel, DEFAULT_MODEL_ID } = require('./src/whisper-model-catalog');
const { locateWhisperRuntime } = require('./src/whisper-runtime');
const { LocalWhisperTranscriber } = require('./src/local-whisper-transcriber');

let win = null;
// Which global shortcuts Clarity actually holds. `globalShortcut.register` returns
// false when another application already owns the combination, and nothing used
// to look at that — so the only symptom was a key that did nothing. Iris reads
// this and can say which key is taken instead of guessing from a screenshot.
const shortcutState = { assist: false, say: false, leetcode: false, followup: false, recap: false, settings: false, hide: false, quit: false };
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// -------- Windows version helpers --------
// WDA_EXCLUDEFROMCAPTURE (setContentProtection) requires Windows 10 build 19041+.
// os.release() returns the NT kernel version e.g. "10.0.19041" or "10.0.22000" (Win11).
function getWindowsBuild() {
  if (!isWindows) return 0;
  const parts = os.release().split('.').map(Number);
  return parts[2] || 0; // third segment is the build number
}
const WIN_BUILD = getWindowsBuild();
const WIN_SUPPORTS_CONTENT_PROTECTION = !isWindows || WIN_BUILD >= 19041;

let permWin = null;
let settingsPriorityActive = false;
let permissionsHiddenForSettings = false;
let permissionsHiddenForExternalSettings = false;
let externalSettingsActive = false;
let externalSettingsRestoreAfter = 0;
let externalSettingsPane = null;
// Any OS-owned UI (permissions, file pickers, system sheets) must temporarily
// outrank Clarity's overlay. Keep this as one depth-counted coordinator so new
// native-dialog paths cannot each invent subtly different z-order behavior.
let nativeUiDepth = 0;
let permissionsHiddenForNativeUi = false;
let nativeUiRestorePending = false;
let nativeUiRestoreTimer = null;
let nativeUiRestoreNotBefore = 0;
const NATIVE_UI_RESTORE_GRACE_MS = 1200;
// Screen Recording is configured manually on macOS. Permission checks must stay
// passive so Clarity never summons the redundant system recording prompt during
// startup; onboarding points the user to System Settings instead.
const MAIN_WINDOW_LEVEL = 1;
const PERMISSIONS_WINDOW_LEVEL = 2;
const SETTINGS_WINDOW_LEVEL = 3;
const BASE_WINDOW_WIDTH = 700;
const HISTORY_CANVAS_EXTRA = 430;
const HISTORY_CANVAS_HALF = Math.round(HISTORY_CANVAS_EXTRA / 2);

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const transcript = []; // { channel, text, ts } — capped at MAX_TRANSCRIPT_TURNS
const MAX_TRANSCRIPT_TURNS = 200; // ~30–40 minutes of conversation at normal pace
const FLUSH_MS = 900;
const STREAM_INACTIVITY_MS = 25000; // abort a stalled LLM stream so state.busy can't wedge forever
const LIVE_ANSWER_INTERIM_STABLE_MS = 650;
const LIVE_ANSWER_STREAMING_FINAL_MS = 250;
const LIVE_ANSWER_FAST_FALLBACK_MS = 3000;
const MIN_BYTES = Math.floor(16000 * 2 * 0.12); // ~0.12s
const RMS_GATE = 180;
const MAX_PCM_CHUNK_BYTES = 1024 * 1024;
let flushTimer = null;
let whisperModelManager = null;
let resourceContextIndex = null;
let localWhisperTranscriber = null;
let activeWhisperModelId = null;
let desiredCaptureState = false;
let captureTransition = Promise.resolve(false);
let liveAnswerTimer = null;
let lastAutoAnsweredQuestion = '';
let transcriptArchive = null;

// -------- streaming STT state --------
let streamingSTT = { you: null, them: null }; // streaming STT instances per channel
let streamingMode = false; // true when using WebSocket streaming STT
let streamingGeneration = 0;
const failedStreamingProviders = new Set();
const vad = {
  you: new AdaptiveVAD({
    onsetThreshold: 220,
    offsetThreshold: 130,
    silenceFrames: 18,       // ~540ms silence before end
    onSpeechStart: () => send('vad:state', { channel: 'you', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'you', speaking: false, durationMs: dur })
  }),
  them: new AdaptiveVAD({
    onsetThreshold: 200,
    offsetThreshold: 120,
    silenceFrames: 20,       // ~600ms for remote audio (more forgiving)
    onSpeechStart: () => send('vad:state', { channel: 'them', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'them', speaking: false, durationMs: dur })
  })
};
// Pre-speech ring buffers (300ms) so we never clip the start of a word
const ringBuffers = {
  you: new AudioRingBuffer(300, 16000),
  them: new AudioRingBuffer(300, 16000)
};

function pushTranscript(turn) {
  transcript.push(turn);
  if (transcriptArchive?.current) {
    try { transcriptArchive.append(turn); }
    catch (error) { recordEvent({ level: 'error', event: 'transcript_archive_failed', msg: error.message, frame: 'pushTranscript' }); }
  }
  if (transcript.length > MAX_TRANSCRIPT_TURNS) transcript.splice(0, transcript.length - MAX_TRANSCRIPT_TURNS);
  scheduleLiveAnswer(turn);
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

function scheduleLiveAnswer(turn) {
  clearTimeout(liveAnswerTimer);
  liveAnswerTimer = null;

  // If the candidate has started talking, do not interrupt them with an answer
  // generated from an earlier fragment of the interviewer's speech.
  if (!turn || turn.channel !== 'them') {
    if (turn?.channel === 'you' && activeResponseMeta?.autoLiveAnswer) stopResponse();
    return;
  }

  const question = collectRecentInterviewerQuestion(transcript);
  scheduleLiveAnswerQuestion(question, { source: 'final', observedAt: turn.ts });
}

function scheduleLiveAnswerInterim(channel, text) {
  if (channel === 'you') {
    clearTimeout(liveAnswerTimer);
    liveAnswerTimer = null;
    if (activeResponseMeta?.autoLiveAnswer) stopResponse();
    return;
  }
  if (channel !== 'them' || !String(text || '').trim()) return;
  const observedAt = Date.now();
  const question = collectRecentInterviewerQuestion(transcript, { interimText: text, interimTs: observedAt });
  scheduleLiveAnswerQuestion(question, { source: 'interim', observedAt });
}

function scheduleLiveAnswerQuestion(question, { source = 'final', observedAt = Date.now() } = {}) {
  clearTimeout(liveAnswerTimer);
  liveAnswerTimer = null;

  const settings = store.getSettings();
  if (!settings.liveAnswerSuggestions || !state.capturing) return;
  if (!isLikelyInterviewQuestion(question)) return;

  if (activeResponseMeta?.autoLiveAnswer) {
    if (questionsEquivalent(activeResponseMeta.question, question)) return;
    if (shouldReplaceLiveAnswerQuestion(activeResponseMeta.question, question)) stopResponse();
    else return;
  }

  if (questionsEquivalent(question, lastAutoAnsweredQuestion)) return;
  const configuredDelay = Math.max(250, Math.min(900, Number(settings.liveAnswerDelayMs) || 700));
  const delay = source === 'interim'
    ? LIVE_ANSWER_INTERIM_STABLE_MS
    : (streamingMode ? LIVE_ANSWER_STREAMING_FINAL_MS : configuredDelay);

  liveAnswerTimer = setTimeout(() => {
    liveAnswerTimer = null;
    const currentSettings = store.getSettings();
    if (!currentSettings.liveAnswerSuggestions || !state.capturing) return;
    if (!isLikelyInterviewQuestion(question) || questionsEquivalent(question, lastAutoAnsweredQuestion)) return;

    // If another answer is still streaming, retry shortly rather than dropping
    // the interviewer question. A newer transcript turn will cancel this timer.
    if (state.busy) {
      liveAnswerTimer = setTimeout(() => scheduleLiveAnswerQuestion(question, { source, observedAt }), 350);
      return;
    }

    lastAutoAnsweredQuestion = question;
    send('status', { message: 'Live Answer: drafting a reply to the interviewer…' });
    runFeature('answerThis', question, {
      autoLiveAnswer: true,
      question,
      source,
      observedAt,
      triggeredAt: Date.now()
    });
  }, delay);
}

function getWhisperRuntime() {
  return locateWhisperRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    architecture: process.arch,
    environment: process.env
  });
}

let transcriptSessionStartedAt = 0;
function publishTranscript(channel, text) {
  if (!text || !text.trim()) return;
  const turn = { channel, text: text.trim(), ts: Date.now() };
  if (shouldSuppressMicEcho(turn)) return;
  let corrected = false;
  if (channel === 'them') {
    // Inference completion order can differ from capture order. Prefer the
    // loopback attribution when its microphone copy was published first.
    for (let i = transcript.length - 1; i >= 0; i--) {
      const prior = transcript[i];
      if (prior.ts < transcriptSessionStartedAt || turn.ts - prior.ts > 12000) break;
      if (prior.channel === 'you' && isLikelyTranscriptEcho(prior.text, turn.text)) {
        transcript.splice(i, 1);
        try { transcriptArchive?.remove?.(prior); }
        catch (error) { recordEvent({ level: 'error', event: 'transcript_archive_failed', msg: error.message, frame: 'publishTranscript' }); }
        corrected = true;
      }
    }
  }
  pushTranscript(turn);
  if (corrected) send('transcript:sync', transcript);
  else send('transcript', turn);
  send('stt:final', { channel, text: turn.text });
}

function shouldSuppressMicEcho(turn) {
  if (!turn || turn.channel !== 'you') return false;
  return transcript.some(prior => prior.ts >= transcriptSessionStartedAt && prior.channel === 'them' &&
    turn.ts >= prior.ts && turn.ts - prior.ts <= 12000 &&
    isLikelyTranscriptEcho(turn.text, prior.text));
}

async function startLocalWhisper(settings) {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const localSettings = settings.localWhisper || {};
  const model = requireWhisperModel(localSettings.modelId || DEFAULT_MODEL_ID);
  const runtime = getWhisperRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  activeWhisperModelId = model.id;
  let transcriber = null;
  try {
    const modelPath = await whisperModelManager.verifyInstalledModel(model.id).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Download the ${model.id} model in Settings → Audio before listening.`);
      }
      throw error;
    });

    transcriber = new LocalWhisperTranscriber({
      sessionOptions: {
        executablePath: runtime.executablePath,
        runtimeDirectory: runtime.runtimeDirectory,
        modelPath,
        language: model.englishOnly ? 'en' : (localSettings.language || 'auto'),
        threads: Number(localSettings.threads) || 0,
        tinydiarize: model.tinydiarize,
        initialPrompt: buildVocabPrompt(settings)
      },
      onTranscript: publishTranscript,
      onSpeechState: (channel, speaking, durationMs) => {
        send('vad:state', { channel, speaking, durationMs });
      },
      onStatus: (status) => send('stt:status', { provider: 'local', ...status }),
      onError: (error) => {
        sttDisabled = true;
        desiredCaptureState = false;
        captureTransition = captureTransition.catch(() => false).then(() => setCapturing(false));
        console.log('[local-whisper] error', error && error.message);
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription error: ${error.message}. Audio was not sent to a cloud fallback.` });
      }
    });

    localWhisperTranscriber = transcriber;
    await transcriber.start();
  } catch (error) {
    if (localWhisperTranscriber === transcriber) localWhisperTranscriber = null;
    activeWhisperModelId = null;
    if (transcriber) await transcriber.forceStop().catch(() => {});
    throw error;
  }
}

async function getWhisperOverview() {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const runtime = getWhisperRuntime();
  const models = await whisperModelManager.listModels();
  return {
    runtime: {
      available: runtime.available,
      version: runtime.version,
      target: runtime.target,
      message: runtime.message || null
    },
    models
  };
}

// -------- window --------
function createWindow() {
  const W = BASE_WINDOW_WIDTH + HISTORY_CANVAS_EXTRA;

  const savedSettings = store.getSettings();
  let targetDisplay = screen.getPrimaryDisplay();
  if (savedSettings.windowX !== null && savedSettings.windowY !== null) {
    targetDisplay = screen.getDisplayNearestPoint({
      x: Math.round(savedSettings.windowX),
      y: Math.round(savedSettings.windowY)
    });
  }
  const { workArea } = targetDisplay;
  const H = Math.min(820, workArea.height);
  // windowX is stored as the logical x-position of the original 700px Clarity
  // surface. The actual BrowserWindow permanently includes transparent space
  // for Conversation History so toggling it never resizes or moves macOS UI.
  let logicalStartX = Math.round(workArea.x + (workArea.width - BASE_WINDOW_WIDTH) / 2);
  let startY = workArea.y + 6;

  if (savedSettings.windowX !== null && savedSettings.windowY !== null) {
    const clampedX = Math.max(workArea.x - BASE_WINDOW_WIDTH + 100, Math.min(savedSettings.windowX, workArea.x + workArea.width - 100));
    const clampedY = Math.max(workArea.y, Math.min(savedSettings.windowY, workArea.y + workArea.height - 40));
    logicalStartX = clampedX;
    startY = clampedY;
  }
  const startX = logicalStartX - HISTORY_CANVAS_HALF;

  const winOptions = {
    width: W,
    height: H,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };

  // Fix 1: On Windows, set type:'toolbar' which sets WS_EX_TOOLWINDOW.
  // This removes the window from Alt+Tab AND the taskbar entirely.
  // On macOS, this is not needed (dock hiding + Mission Control handle it).
  if (isWindows) {
    winOptions.type = 'toolbar';
  }

  win = new BrowserWindow(winOptions);

  // Fix 2: Only call setContentProtection if the OS supports it.
  // On Windows, WDA_EXCLUDEFROMCAPTURE requires build 19041+ (Windows 10 May 2020 Update).
  // On older builds we skip it silently to avoid a no-op and send a warning to the renderer.
  const shouldProtect = !process.env.CLARITY_NO_PROTECT;
  if (shouldProtect) {
    if (WIN_SUPPORTS_CONTENT_PROTECTION) {
      win.setContentProtection(true);
    } else {
      // Will notify the renderer after it loads
      console.log(`[Clarity] Windows build ${WIN_BUILD} < 19041 — setContentProtection not supported. Window may appear in screen shares.`);
    }
  }

  win.setAlwaysOnTop(true, 'screen-saver', MAIN_WINDOW_LEVEL);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac && typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  let moveSaveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const [x, y] = win.getPosition();
        // Persist the logical 700px Clarity position so existing saved placements
        // remain compatible with the permanently wider transparent canvas.
        store.setSettings({ windowX: x + HISTORY_CANVAS_HALF, windowY: y });
      }
    }, 500);
  });

  win.setTitle(PRODUCT_NAME);

  win.webContents.on('before-input-event', (event, input) => {
    const next = nextZoomFactor(input, win.webContents.getZoomFactor(), isMac);
    if (next === null) return;
    event.preventDefault();
    win.webContents.setZoomFactor(next);
    win.setIgnoreMouseEvents(false);
    send('mouse:interactive', {});
  });

  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    win.setTitle(PRODUCT_NAME);
    // Warn about missing content protection on old Windows builds
    if (isWindows && shouldProtect && !WIN_SUPPORTS_CONTENT_PROTECTION) {
      send('status', {
        message: `Heads up: your Windows version (build ${WIN_BUILD}) does not support screen-share hiding. Upgrade to Windows 10 build 19041+ or Windows 11 to enable invisibility in screen shares.`
      });
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('[Clarity] renderer gone', JSON.stringify(d));
    recordEvent({ level: 'fatal', event: 'renderer_gone', code: d && d.reason, msg: 'renderer process ended: ' + JSON.stringify(d), frame: 'BrowserWindow' });
  });
}

// -------- STT flushing (batch mode fallback) --------
async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: 'No transcription key set. Add an OpenAI (Whisper), Deepgram, or Gemini key in Settings to enable listening. Screen/LeetCode features work without it.' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim() && res.text.trim().length > 1 && !/^[?!.,;:\-…]+$/.test(res.text.trim())) {
      publishTranscript(channel, res.text);
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
    recordEvent({ level: 'error', event: 'stt_failed', msg: e && e.message ? e.message : String(e), frame: 'flushChannel', context: { channel } });
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  // Recorded before the early return, because the second and hundredth
  // occurrence still tell you the state Clarity is stuck in.
  recordEvent({
    level: 'error',
    event: 'stt_rejected',
    code: err.code || (err.status ? 'http_' + err.status : null),
    msg: err.message,
    frame: 'handleSttError',
    context: { provider: err.provider, status: err.status || null, alreadyDisabled: sttDisabled },
  });
  if (sttDisabled) return;
  const isQuota = err.status === 429 || err.code === 'RESOURCE_EXHAUSTED' || (err.message && err.message.includes('Quota exceeded'));
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found' || isQuota;
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', { message: `Transcription off: your ${err.provider} key was rejected or hit a quota limit. Update your key in Settings to resume.` });
  } else {
    send('status', { message: 'Transcription error (' + err.provider + '): ' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- streaming STT setup --------
function normalizeStreamingProvider(provider) {
  return provider === 'openai-realtime' ? 'openai' : String(provider || '').toLowerCase();
}

function initStreamingSTT() {
  const settings = store.getSettings();
  streamingMode = false;
  const generation = ++streamingGeneration;

  ['you', 'them'].forEach((channel) => {
    const sttInstance = createStreamingSTT(settings, channel, {
      onTranscript: publishTranscript,
      onInterim: (ch, text) => {
        send('stt:interim', { channel: ch, text });
        scheduleLiveAnswerInterim(ch, text);
      },
      onError: (err) => {
        if (generation !== streamingGeneration) return;
        console.log('[streaming-stt] error', err.provider, err.message);
        const failedProvider = normalizeStreamingProvider(err.provider);
        if ((settings.sttProvider || 'auto') === 'auto' && failedProvider) {
          failedStreamingProviders.add(failedProvider);
          stopStreamingSTT();
          if (initStreamingSTT()) {
            send('status', { message: `Streaming transcription (${err.provider}) failed. Switching to the next streaming provider.` });
            return;
          }
        } else {
          stopStreamingSTT();
        }

        const batchFallbackAvailable = createSTT(settings).available;
        if (batchFallbackAvailable) {
          send('status', { message: `Streaming transcription (${err.provider}) error: ${err.message}. Falling back to batch mode.` });
          startFlushLoop();
        } else if (!sttDisabled) {
          sttDisabled = true;
          send('status', { message: `Transcription stopped (${err.provider}): ${err.message}. The selected provider has no batch fallback.` });
        }
        streamingMode = false;
      },
      onStatusChange: (ch, status) => {
        send('stt:status', { channel: ch, status });
        if (status === 'connected') {
          console.log(`[streaming-stt] ${ch} channel connected`);
        }
      }
    }, { skipProviders: [...failedStreamingProviders] });

    if (sttInstance.type === 'streaming' && sttInstance.instance) {
      streamingMode = true;
      streamingSTT[channel] = sttInstance.instance;
      sttInstance.instance.connect();
    }
  });

  return streamingMode;
}

function stopStreamingSTT() {
  streamingGeneration += 1;
  ['you', 'them'].forEach((channel) => {
    if (streamingSTT[channel]) {
      streamingSTT[channel].disconnect();
      streamingSTT[channel] = null;
    }
  });
  streamingMode = false;
}

// -------- audio routing (streaming or batch) --------
function routeAudio(channel, pcmBuffer) {
  if (sttDisabled) return;
  const buf = Buffer.from(pcmBuffer);

  if (localWhisperTranscriber) {
    localWhisperTranscriber.push(channel, buf);
    return;
  }

  // Always run through VAD for speech state detection
  vad[channel].processChunk(buf);

  // Keep pre-speech buffer
  ringBuffers[channel].write(buf);

  if (streamingMode && streamingSTT[channel]) {
    // Streaming mode: send raw PCM directly to the WebSocket
    streamingSTT[channel].sendAudio(pcmBuffer);
  } else {
    // Batch mode: accumulate in buffers for periodic flush
    buffers[channel].push(buf);
  }
}

function startTranscriptArchive() {
  if (!transcriptArchive || !store.getSettings().saveTranscripts || transcriptArchive.current) return;
  try {
    const saved = transcriptArchive.start();
    console.log('[clarity] transcript archive started:', saved.file);
    send('status', { message: 'Transcript saving is on · Documents → Clarity Transcripts.' });
  } catch (error) {
    recordEvent({ level: 'error', event: 'transcript_archive_start_failed', msg: error.message, frame: 'startTranscriptArchive' });
    send('status', { message: `Could not start transcript saving: ${error.message}` });
  }
}

function finishTranscriptArchive() {
  if (!transcriptArchive?.current) return;
  try { transcriptArchive.finish(); }
  catch (error) { recordEvent({ level: 'error', event: 'transcript_archive_finish_failed', msg: error.message, frame: 'finishTranscriptArchive' }); }
}

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside Clarity's own process
// and use Clarity's own Screen-Recording grant — no separate helper binary to authorize.
async function setCapturing(active) {
  if (active === state.capturing) return state.capturing;

  if (active) {
    transcriptSessionStartedAt = Date.now();
    sttDisabled = false; // reset on re-enable
    lastAutoAnsweredQuestion = '';
    failedStreamingProviders.clear();
    const settings = store.getSettings();
    if ((settings.sttProvider || 'auto') === 'local') {
      try {
        await startLocalWhisper(settings);
        state.capturing = true;
        startTranscriptArchive();
        console.log('[Clarity] capture started, mode: local');
        send('capture:state', { active: true, streaming: false, mode: 'local' });
        return true;
      } catch (error) {
        state.capturing = false;
        desiredCaptureState = false;
        if (error.code === 'STARTUP_CANCELLED') {
          send('stt:status', { provider: 'local', status: 'off' });
          send('capture:state', { active: false, streaming: false, mode: 'local' });
          return false;
        }
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription could not start: ${error.message} No audio was sent to a cloud provider.` });
        send('capture:state', { active: false, streaming: false, mode: 'local' });
        return false;
      }
    }

    if (!createSTT(settings).available && !(['auto', 'deepgram'].includes(settings.sttProvider || 'auto') && settings.apiKeys?.deepgram)) {
      desiredCaptureState = false;
      send('status', { message: `Set up speech-to-text in Settings → Audio. Choose Local and download ${DEFAULT_MODEL_ID}, or configure a speech provider key.` });
      send('capture:state', { active: false, streaming: false, mode: 'off' });
      return false;
    }
    state.capturing = true;
    startTranscriptArchive();
    // Try streaming first, fall back to batch
    const streaming = initStreamingSTT();
    if (!streaming) {
      startFlushLoop();
    }
    console.log('[Clarity] capture started, mode:', streaming ? 'streaming' : 'batch');
    send('capture:state', { active: true, streaming: streamingMode, mode: streaming ? 'streaming' : 'batch' });
    return true;
  }

  state.capturing = false;
  clearTimeout(liveAnswerTimer);
  liveAnswerTimer = null;
  stopFlushLoop();
  stopStreamingSTT();
  buffers.you = []; buffers.them = [];
  vad.you.reset(); vad.them.reset();
  ringBuffers.you.clear(); ringBuffers.them.clear();
  const stoppingLocalTranscriber = localWhisperTranscriber;
  localWhisperTranscriber = null;
  send('capture:state', { active: false, streaming: false, mode: stoppingLocalTranscriber ? 'local' : 'off' });
  if (stoppingLocalTranscriber) {
    send('stt:status', { provider: 'local', status: 'stopping' });
    try {
      await stoppingLocalTranscriber.stop();
    } catch (error) {
      console.log('[local-whisper] stop error', error && error.message);
    } finally {
      activeWhisperModelId = null;
    }
  }
  finishTranscriptArchive();
  return false;
}

// -------- feature runner --------
let activeResponseController = null;
let activeResponseMeta = null;
function stopResponse() {
  clearTimeout(liveAnswerTimer);
  liveAnswerTimer = null;
  activeResponseController?.abort();
}
async function runFeature(mode, userText, runOptions = {}) {
  if (state.busy) return;
  const def = MODES[mode];
  if (!def) return;
  state.busy = true;
  const streamController = new AbortController();
  activeResponseController = streamController;
  activeResponseMeta = runOptions.autoLiveAnswer
    ? { autoLiveAnswer: true, question: runOptions.question || userText || '', source: runOptions.source || 'final' }
    : { autoLiveAnswer: false };
  let streamSettled = false; // drop stray tokens from a stream we've already abandoned
  let firstTokenAt = 0;
  let winningModel = null;
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings);
    winningModel = llm.model;
    const userBubble = def.userBubble !== null
      ? def.userBubble
      : (mode === 'ask' ? userText : mode === 'answerThis' ? `"${(userText || '').slice(0, 60)}${userText && userText.length > 60 ? '…' : ''}"` : null);
    const category = mode !== 'leetcode' ? detectCategory(transcript) : null;
    send('llm:start', { userBubble, small: !!def.small, category });

    if (!llm.ready) {
      const message = llm.configurationError || ('Complete the ' + settings.provider + ' provider settings. Model: ' + (llm.model || 'unset') + '.');
      send('llm:error', { message });
      return;
    }

    let imageDataUrl = null;
    if (def.needsScreen) {
      const screenPermissionStatus = isMac ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
      if (isMac && screenPermissionStatus !== 'granted') {
        const message = 'Screen & System Audio Recording permission is required. Open System Settings → Privacy & Security → Screen & System Audio Recording, add or enable Clarity, then try again.';
        send('status', { message });
        send('llm:error', { message });
        return;
      }
      try {
        const displayId = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).id : null;
        imageDataUrl = await abortable(captureScreenshot(displayId), streamController.signal);
        if (!imageDataUrl) throw new Error('No screen source was available.');
      }
      catch (e) {
        if (streamController.signal.aborted) throw e;
        recordEvent({ level: 'error', event: 'screen_capture_failed', msg: e && e.message ? e.message : String(e), frame: 'captureScreenshot', context: { mode } });
        const message = process.platform === 'darwin'
          ? 'Screen capture needs permission — grant Screen Recording to Clarity in System Settings.'
          : process.platform === 'win32'
            ? 'Screen capture failed. Make sure Clarity is not blocked by Windows privacy or security software, then try again.'
            : 'Screen capture failed. Check your desktop capture permissions, then try again.';
        send('status', { message });
        send('llm:error', { message });
        return;
      }
    }

    const settingsForPrompt = store.getSettings();
    const contextBlock = buildInterviewContext(settingsForPrompt, mode, transcript);
    let system = def.buildSystem ? def.buildSystem(contextBlock, settingsForPrompt.aiRules || '') : (def.system || '');
    const built = def.build({ transcript, userText: userText || '' });
    if (mode !== 'leetcode' && resourceContextIndex) {
      const recentQuestionContext = transcript
        .filter((turn) => turn.channel === 'them')
        .slice(-5)
        .map((turn) => turn.text)
        .join('\n');
      const resourceQuery = [userText || '', recentQuestionContext].filter(Boolean).join('\n');
      const resourceMatches = resourceContextIndex.search(resourceQuery);
      system = appendResourceContext(system, resourceMatches);
    }

    // Watchdog: a provider that stalls mid-stream would otherwise hang the await forever,
    // leaving state.busy = true and wedging every later question until an app restart.
    let watchdog = null;
    let deadline = null;
    let rearm = () => {};
    const stalled = new Promise((_res, reject) => {
      deadline = setTimeout(() => reject(new Error('The answer took too long. Try a faster model or a shorter question.')), 180000);
      rearm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => reject(new Error('the model stopped responding (timed out). Please try again.')), STREAM_INACTIVITY_MS);
      };
      rearm();
    });
    try {
      const streamOptions = {
          system,
          signal: streamController.signal,
          turns: [{ role: 'user', text: built }],
          imageDataUrl,
          onProgress: () => { if (!streamSettled && !streamController.signal.aborted) rearm(); },
          onToken: (t) => {
            if (streamSettled || streamController.signal.aborted) return;
            rearm();
            if (!firstTokenAt) {
              firstTokenAt = Date.now();
              if (runOptions.autoLiveAnswer) {
                recordEvent({
                  level: 'info',
                  event: 'live_answer_latency',
                  frame: 'runFeature',
                  context: {
                    source: runOptions.source || 'final',
                    model: winningModel || llm.model,
                    observedToFirstTokenMs: Math.max(0, firstTokenAt - (Number(runOptions.observedAt) || firstTokenAt)),
                    triggeredToFirstTokenMs: Math.max(0, firstTokenAt - (Number(runOptions.triggeredAt) || firstTokenAt))
                  }
                });
              }
            }
            send('llm:token', { text: t });
          }
      };
      // Coding answers regularly need more than the conversational token budget
      // once they include a complete implementation plus complexity analysis.
      if (mode === 'leetcode') streamOptions.maxTokens = settings.smart ? 6500 : 4500;
      let answerStream;
      if (runOptions.autoLiveAnswer && !settings.smart) {
        const smartLLM = createLLM({ ...settings, smart: true });
        if (smartLLM.ready && smartLLM.model !== llm.model) {
          answerStream = streamWithSmartFallback({
            fast: llm,
            smart: smartLLM,
            streamOptions,
            signal: streamController.signal,
            fallbackDelayMs: LIVE_ANSWER_FAST_FALLBACK_MS,
            onWinner: (tier, model) => {
              winningModel = model;
              recordEvent({
                level: 'info',
                event: 'live_answer_model_winner',
                frame: 'runFeature',
                context: { tier, model }
              });
            }
          });
        }
      }
      if (!answerStream) answerStream = llm.stream(streamOptions);
      await Promise.race([abortable(answerStream, streamController.signal), stalled]);
    } finally {
      streamSettled = true;
      clearTimeout(watchdog);
      clearTimeout(deadline);
    }
    send('llm:done', {});
  } catch (e) {
    if (streamController.signal.aborted) {
      send('llm:done', { stopped: true });
      return;
    }
    recordEvent({ level: 'error', event: 'llm_failed', msg: e && e.message ? e.message : String(e), frame: 'runFeature', context: { mode, provider: store.getSettings().provider } });
    if (runOptions.autoLiveAnswer && !firstTokenAt) lastAutoAnsweredQuestion = '';
    send('llm:error', { message: e && e.message ? e.message : String(e) });
  } finally {
    streamSettled = true;
    streamController.abort();
    if (activeResponseController === streamController) activeResponseController = null;
    activeResponseMeta = null;
    state.busy = false;
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  sttDisabled = false;
  const previousSettings = store.getSettings();
  const wasSaving = !!previousSettings.saveTranscripts;
  const updated = store.setSettings(patch);
  const isSaving = !!updated.saveTranscripts;
  if (state.capturing && wasSaving !== isSaving) {
    if (isSaving) startTranscriptArchive();
    else finishTranscriptArchive();
  }
  const resourcesChanged = JSON.stringify(previousSettings.resourceRepositories || []) !== JSON.stringify(updated.resourceRepositories || []) ||
    String(previousSettings.githubToken || '') !== String(updated.githubToken || '');
  if (resourcesChanged && resourceContextIndex) {
    resourceContextIndex.refresh(updated.resourceRepositories || [], { githubToken: updated.githubToken || '' })
      .then((status) => send('resources:status', status))
      .catch((error) => send('resources:status', { error: error.message }));
  }
  return updated;
});
ipcMain.handle('resources:status', () => {
  if (!resourceContextIndex) return { configured: 0, indexed: 0, files: 0, chunks: 0, updatedAt: null, stale: false, errors: [] };
  return resourceContextIndex.status(store.getSettings().resourceRepositories || []);
});
ipcMain.handle('resources:refresh', async () => {
  if (!resourceContextIndex) throw new Error('Resource index is not ready yet.');
  const settings = store.getSettings();
  const status = await resourceContextIndex.refresh(settings.resourceRepositories || [], { githubToken: settings.githubToken || '' });
  send('resources:status', status);
  return status;
});
function requestCapturing(targetState) {
  desiredCaptureState = targetState;
  if (!targetState && !state.capturing && localWhisperTranscriber) {
    localWhisperTranscriber.forceStop().catch(() => {});
  }
  captureTransition = captureTransition
    .catch(() => state.capturing)
    .then(() => setCapturing(targetState));
  return captureTransition;
}
ipcMain.handle('capture:toggle', () => requestCapturing(!desiredCaptureState));
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('whisper:models', () => getWhisperOverview());
ipcMain.handle('whisper:model-download', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const result = await whisperModelManager.download(modelId, (progress) => send('whisper:download-progress', progress));
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-cancel', (_event, modelId) => {
  if (!whisperModelManager) return false;
  return whisperModelManager.cancelDownload(modelId);
});
ipcMain.handle('whisper:model-delete', async (_event, modelId) => {
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before deleting the active model.');
  }
  const result = await whisperModelManager.deleteModel(modelId);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-import', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before replacing the active model.');
  }
  const selection = await showNativeOpenDialog({
    title: `Import ggml-${modelId}.bin`,
    properties: ['openFile'],
    filters: [{ name: 'whisper.cpp model', extensions: ['bin'] }]
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const result = await whisperModelManager.importModel(modelId, selection.filePaths[0]);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('platform:info', () => ({
  platform: process.platform,
  winBuild: WIN_BUILD,
  winSupportsContentProtection: WIN_SUPPORTS_CONTENT_PROTECTION
}));
ipcMain.handle('transcript:clear', () => {
  transcript.splice(0, transcript.length);
  lastAutoAnsweredQuestion = '';
  return { ok: true };
});
ipcMain.handle('transcript:open-folder', async () => {
  if (!transcriptArchive) throw new Error('Transcript storage is not ready yet.');
  const directory = transcriptArchive.ensureDirectory();
  let selection;
  try {
    selection = await showNativeOpenDialog({
      title: 'Saved transcripts',
      defaultPath: directory,
      buttonLabel: 'Open Transcript',
      properties: ['openFile'],
      filters: [{ name: 'Transcript text', extensions: ['txt'] }]
    });
  } finally {
    // A Finder window has no close callback. A native dialog does, so closing
    // this browser can reliably restore the same Clarity settings window.
    returnToClarity();
  }
  if (selection.canceled || !selection.filePaths.length) return { ok: true, canceled: true };
  await yieldToExternalSettings();
  try {
    const error = await shell.openPath(selection.filePaths[0]);
    if (error) throw new Error(error);
  } catch (error) {
    restoreAfterExternalSettings();
    throw error;
  }
  return { ok: true, directory };
});
function isMainRendererSender(sender) {
  return !!(win && !win.isDestroyed() && sender && sender.id === win.webContents.id);
}
function isValidPcmPayload(value) {
  return value instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= MAX_PCM_CHUNK_BYTES;
}
ipcMain.on('llm:stop', (event) => {
  if (!isMainRendererSender(event.sender)) return;
  stopResponse();
});
ipcMain.on('ask', (event, payload) => {
  if (!isMainRendererSender(event.sender) || !payload || typeof payload !== 'object') return;
  const mode = typeof payload.mode === 'string' ? payload.mode : '';
  if (!MODES[mode]) return;
  const text = typeof payload.text === 'string' ? payload.text.slice(0, 20000) : '';
  runFeature(mode, text);
});
ipcMain.on('mic:pcm', (event, arrayBuffer) => {
  if (state.capturing && isMainRendererSender(event.sender) && isValidPcmPayload(arrayBuffer)) routeAudio('you', arrayBuffer);
});
ipcMain.on('system:pcm', (event, arrayBuffer) => {
  if (state.capturing && isMainRendererSender(event.sender) && isValidPcmPayload(arrayBuffer)) routeAudio('them', arrayBuffer);
});
let windowDrag = null;
ipcMain.on('window:drag', (event, phase) => {
  if (!isMainRendererSender(event.sender) || !win || win.isDestroyed()) return;
  if (phase === 'end') { windowDrag = null; return; }
  if (isForegroundYieldActive() || !win.isVisible()) { windowDrag = null; return; }
  if (phase === 'start') {
    windowDrag = { target: win, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
    win.setIgnoreMouseEvents(false);
    return;
  }
  if (phase !== 'move' || !windowDrag || windowDrag.target !== win) return;
  const cursor = screen.getCursorScreenPoint();
  win.setPosition(Math.round(windowDrag.bounds.x + cursor.x - windowDrag.cursor.x),
    Math.round(windowDrag.bounds.y + cursor.y - windowDrag.cursor.y));
});
let toolbarWakeTimer = null;
ipcMain.on('mouse:ignore', (event, ignored, toolbar) => {
  if (!isMainRendererSender(event.sender) || !win || win.isDestroyed()) return;
  if (toolbarWakeTimer) clearInterval(toolbarWakeTimer);
  toolbarWakeTimer = null;
  if (windowDrag) return;
  win.setIgnoreMouseEvents(!!ignored, { forward: true });
  if (!ignored || !toolbar || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(toolbar[key]))) return;
  // Native drag regions swallow renderer mouse events. Wake the toolbar from
  // screen coordinates instead of dynamically removing its native drag region.
  const target = win;
  toolbarWakeTimer = setInterval(() => {
    if (target.isDestroyed()) {
      clearInterval(toolbarWakeTimer);
      toolbarWakeTimer = null;
      return;
    }
    if (!target.isVisible() || isForegroundYieldActive()) return;
    const bounds = target.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const zoom = target.webContents.getZoomFactor();
    const x = (cursor.x - bounds.x) / zoom, y = (cursor.y - bounds.y) / zoom;
    if (x < toolbar.x || x >= toolbar.x + toolbar.width || y < toolbar.y || y >= toolbar.y + toolbar.height) return;
    target.setIgnoreMouseEvents(false);
    send('mouse:interactive', {});
    clearInterval(toolbarWakeTimer);
    toolbarWakeTimer = null;
  }, 30);
  toolbarWakeTimer.unref();
});
function isAllowedPaneUrl(url) {
  if (typeof url !== 'string') return false;
  return /^ms-settings:privacy-(?:microphone|screenrecorder)$/i.test(url) ||
    /^x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_(?:Microphone|ScreenCapture)$/i.test(url);
}
async function yieldToExternalSettings() {
  externalSettingsActive = true;
  externalSettingsRestoreAfter = Date.now() + 750;

  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(false);
    win.blur();
  }

  if (permWin && !permWin.isDestroyed()) {
    permissionsHiddenForExternalSettings ||= permWin.isVisible();
    permWin.setAlwaysOnTop(false);
    if (permissionsHiddenForExternalSettings) permWin.hide();
  }
}

function restoreAfterExternalSettings() {
  if (!externalSettingsActive) return;
  const pane = externalSettingsPane;
  externalSettingsActive = false;
  externalSettingsRestoreAfter = 0;
  externalSettingsPane = null;

  permissionsHiddenForNativeUi ||= permissionsHiddenForExternalSettings;
  permissionsHiddenForExternalSettings = false;
  restoreAfterNativeUiYield();

  // Screen Recording changes can take a moment to propagate through TCC, and
  // on some macOS versions the running process must be relaunched before the
  // new grant is visible. Re-check automatically after the user returns from
  // System Settings so the permission card never sits on stale state.
  if (permWin && !permWin.isDestroyed()) {
    setTimeout(() => {
      if (permWin && !permWin.isDestroyed()) {
        permWin.webContents.send('permissions:refresh', { pane });
      }
    }, 350);
  }
}

function isForegroundYieldActive() {
  return nativeUiDepth > 0 || nativeUiRestorePending || externalSettingsActive;
}

function beginNativeUiYield({ blur = true } = {}) {
  if (nativeUiRestoreTimer) {
    clearTimeout(nativeUiRestoreTimer);
    nativeUiRestoreTimer = null;
  }
  nativeUiRestorePending = false;
  if (isMac) nativeUiRestoreNotBefore = Date.now() + NATIVE_UI_RESTORE_GRACE_MS;
  nativeUiDepth += 1;
  if (nativeUiDepth > 1) return { ok: true };

  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(false);
    if (blur) win.blur();
  }

  if (permWin && !permWin.isDestroyed()) {
    permissionsHiddenForNativeUi ||= permWin.isVisible();
    permWin.setAlwaysOnTop(false);
    if (permissionsHiddenForNativeUi) permWin.hide();
  }
  return { ok: true };
}

function restoreAfterNativeUiYield() {
  if (nativeUiDepth > 0 || externalSettingsActive) return { ok: true, pending: true };

  // macOS can resolve a native permission/file sheet before its animation has
  // fully left the screen. Do not restore Clarity's floating level until the
  // grace period has elapsed AND the BrowserWindow itself owns focus again.
  // This prevents a late system sheet from ending up behind Clarity.
  if (isMac && win && !win.isDestroyed()) {
    const remaining = nativeUiRestoreNotBefore - Date.now();
    const clarityFocused = win.isFocused() || !!(permWin && !permWin.isDestroyed() && permWin.isFocused());
    if (remaining > 0 || !clarityFocused) {
      nativeUiRestorePending = true;
      if (nativeUiRestoreTimer) clearTimeout(nativeUiRestoreTimer);
      nativeUiRestoreTimer = remaining > 0
        ? setTimeout(() => {
            nativeUiRestoreTimer = null;
            restoreAfterNativeUiYield();
          }, remaining)
        : null;
      return { ok: true, pending: true };
    }
  }

  nativeUiRestorePending = false;
  nativeUiRestoreNotBefore = 0;
  if (nativeUiRestoreTimer) {
    clearTimeout(nativeUiRestoreTimer);
    nativeUiRestoreTimer = null;
  }

  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(
      true,
      'screen-saver',
      settingsPriorityActive ? SETTINGS_WINDOW_LEVEL : MAIN_WINDOW_LEVEL
    );
  }

  if (permissionsHiddenForNativeUi && permWin && !permWin.isDestroyed() && !settingsPriorityActive) {
    permWin.setAlwaysOnTop(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL);
    permWin.show();
    permWin.moveTop();
    permWin.focus();
  }
  if (permissionsHiddenForNativeUi && settingsPriorityActive) permissionsHiddenForSettings = true;
  permissionsHiddenForNativeUi = false;
  return { ok: true, pending: false };
}

function endNativeUiYield() {
  if (nativeUiDepth === 0) return { ok: true };
  nativeUiDepth -= 1;
  if (nativeUiDepth > 0) return { ok: true };

  if (externalSettingsActive) {
    permissionsHiddenForExternalSettings = permissionsHiddenForExternalSettings || permissionsHiddenForNativeUi;
    permissionsHiddenForNativeUi = false;
    return { ok: true };
  }
  return restoreAfterNativeUiYield();
}

async function withNativeUiYield(operation) {
  beginNativeUiYield();
  try {
    return await operation();
  } finally {
    endNativeUiYield();
  }
}

async function showNativeOpenDialog(options) {
  // Every file browser is independent of the transparent overlay, avoiding
  // macOS's full-window sheet backdrop for model and document imports too.
  const overlay = win;
  const wasVisible = overlay && !overlay.isDestroyed() && overlay.isVisible();
  try {
    return await withNativeUiYield(async () => {
      if (wasVisible) overlay.hide();
      return dialog.showOpenDialog(options);
    });
  } finally {
    // The native yield has ended before focus and window levels are restored.
    if (wasVisible && !overlay.isDestroyed()) returnToClarity();
  }
}

// Keep the preload channel names stable. invoke/handle is intentional here: the
// renderer must know Clarity has actually yielded before Chromium/macOS opens a
// permission prompt. Display capture itself stays picker-free.
ipcMain.handle('native-permission-prompt:begin', () => beginNativeUiYield());
ipcMain.handle('native-permission-prompt:end', () => endNativeUiYield());

// Actual loopback startup may show native audio UI. Use the same depth-counted
// coordinator, preserving focus when no sheet is needed. Never use this to probe.
ipcMain.handle('system-audio-permission-prompt:begin', () => beginNativeUiYield({ blur: false }));
ipcMain.handle('system-audio-permission-prompt:end', () => endNativeUiYield());

ipcMain.on('open-pane', async (_e, url) => {
  if (!isAllowedPaneUrl(url)) {
    recordEvent({ level: 'warn', event: 'blocked_external_url', msg: 'renderer requested a non-settings URL', frame: 'open-pane' });
    return;
  }

  externalSettingsPane = /(?:Privacy_ScreenCapture|privacy-screenrecorder)$/i.test(url) ? 'screen' : 'microphone';
  try {
    await yieldToExternalSettings();
    await shell.openExternal(url, isMac ? { activate: true } : undefined);
  } catch (error) {
    restoreAfterExternalSettings();
    recordEvent({ level: 'warn', event: 'open_settings_failed', msg: error.message || String(error), frame: 'open-pane' });
  }
});

app.on('browser-window-focus', (_event, focusedWindow) => {
  if (nativeUiRestorePending && nativeUiDepth === 0 && focusedWindow === win) {
    restoreAfterNativeUiYield();
  }
  if (
    externalSettingsActive &&
    focusedWindow === win &&
    Date.now() >= externalSettingsRestoreAfter
  ) {
    restoreAfterExternalSettings();
  }
});
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('permissions:restart-app', (event) => {
  if (!isMainRendererSender(event.sender) && (!permWin || permWin.isDestroyed() || event.sender.id !== permWin.webContents.id)) return;
  // app.relaunch() starts the replacement before this process has fully exited.
  // Release our single-instance lock first so the new Clarity process can acquire
  // it instead of mistaking the still-shutting-down process for the primary app.
  if (app.hasSingleInstanceLock()) app.releaseSingleInstanceLock();
  app.relaunch();
  app.quit();
});
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));
// -------- resume / job-description file import --------
// The dialog runs in MAIN and is filtered to pdf/docx; the renderer never supplies a path.
// The parsed text is RETURNED to the renderer, which drops it into the existing
// #resume-text / #job-description textareas so settings keep a single source of truth.
async function pickAndParseDocument() {
  const res = await showNativeOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Resume / Job description', extensions: ['pdf', 'docx'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const text = await parseDocumentFile(filePath);
  return { fileName: path.basename(filePath), text };
}
ipcMain.handle('profile:pickDocument', async () => {
  try {
    const picked = await pickAndParseDocument();
    if (!picked) return { canceled: true };
    return { canceled: false, fileName: picked.fileName, text: picked.text };
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.handle('applink:state', () => appLinkConsentState());
ipcMain.handle('applink:revoke', (_e, callerId) => revokeAppLinkCaller(callerId));

// -------- permissions IPC --------
ipcMain.handle('permissions:check', () => getPermissionStatus());
ipcMain.handle('permissions:request', () => requestPermissions());
ipcMain.handle('permissions:microphone', (event) => {
  if (!isMainRendererSender(event.sender) && (!permWin || permWin.isDestroyed() || event.sender.id !== permWin.webContents.id)) throw new Error('Untrusted permission request');
  return requestMicrophoneAccess();
});
ipcMain.on('permissions:open-settings', (event) => {
  if (!permWin || permWin.isDestroyed() || event.sender.id !== permWin.webContents.id) return;
  returnToClarity();
  send('settings:open', {});
});
ipcMain.on('window:settings-priority', (_event, open) => {
  settingsPriorityActive = !!open;
  if (!win || win.isDestroyed()) return;

  // Native/system UI owns the foreground until its yield finishes. Settings can
  // still open/close logically while that happens, but must not re-raise Clarity
  // above an OS permission sheet, picker, or System Settings.
  if (isForegroundYieldActive()) {
    if (settingsPriorityActive) {
      if (permWin && !permWin.isDestroyed() && permWin.isVisible()) {
        permissionsHiddenForSettings = true;
        permWin.setAlwaysOnTop(false);
        permWin.hide();
      }
    } else if (permissionsHiddenForSettings) {
      permissionsHiddenForNativeUi = permissionsHiddenForNativeUi || nativeUiDepth > 0 || nativeUiRestorePending;
      permissionsHiddenForExternalSettings = permissionsHiddenForExternalSettings || externalSettingsActive;
      permissionsHiddenForSettings = false;
    }
    return;
  }

  const level = settingsPriorityActive ? SETTINGS_WINDOW_LEVEL : MAIN_WINDOW_LEVEL;
  win.setAlwaysOnTop(true, 'screen-saver', level);
  win.show();

  if (settingsPriorityActive) {
    if (permWin && !permWin.isDestroyed() && permWin.isVisible()) {
      permissionsHiddenForSettings = true;
      permWin.hide();
    }
    win.moveTop();
    win.focus();
    return;
  }

  if (permissionsHiddenForSettings && permWin && !permWin.isDestroyed()) {
    permissionsHiddenForSettings = false;
    permWin.setAlwaysOnTop(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL);
    permWin.show();
    permWin.moveTop();
    permWin.focus();
  } else {
    permissionsHiddenForSettings = false;
  }
});
ipcMain.on('permissions:continue', async () => {
  const status = await getPermissionStatus();
  if (status.mic === 'granted' && status.screen === 'granted') {
    if (permWin) { permWin.close(); permWin = null; }
    if (win && !win.isDestroyed() && !isForegroundYieldActive()) {
      win.showInactive();
      win.setAlwaysOnTop(
        true,
        'screen-saver',
        settingsPriorityActive ? SETTINGS_WINDOW_LEVEL : MAIN_WINDOW_LEVEL
      );
    }
  }
});

// -------- shortcuts --------
function registerShortcuts() {
  shortcutState.assist = globalShortcut.register('CommandOrControl+Return', () => runFeature('assist', ''));
  shortcutState.say = globalShortcut.register('CommandOrControl+Shift+Return', () => runFeature('say', ''));
  shortcutState.leetcode = globalShortcut.register('CommandOrControl+H', () => runFeature('leetcode', ''));
  shortcutState.followup = globalShortcut.register('CommandOrControl+J', () => runFeature('followup', ''));
  shortcutState.recap = globalShortcut.register('CommandOrControl+K', () => runFeature('recap', ''));
  shortcutState.settings = globalShortcut.register('CommandOrControl+,', () => { returnToClarity(); send('settings:open', {}); });
  if (!shortcutState.settings) {
    shortcutState.settings = globalShortcut.register('CommandOrControl+Shift+,', () => { returnToClarity(); send('settings:open', {}); });
  }
  shortcutState.hide = globalShortcut.register('CommandOrControl+Shift+/', () => { if (externalSettingsActive || nativeUiRestorePending) returnToClarity(); else send('hide:toggle', {}); });
  shortcutState.quit = globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
  for (const [name, wasRegistered] of Object.entries(shortcutState)) {
    if (!wasRegistered) {
      recordEvent({ level: 'warn', event: 'shortcut_unavailable', msg: 'another application holds the ' + name + ' shortcut', frame: 'registerShortcuts', context: { shortcut: name } });
    }
  }
}

// -------- permissions --------
function getScreenPermissionStatus() {
  if (!isMac) return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

async function getPermissionStatus() {
  if (process.platform !== 'darwin') return { mic: 'granted', screen: 'granted' };
  return {
    mic: systemPreferences.getMediaAccessStatus('microphone'),
    // IMPORTANT: this must stay passive. Enumerating screen sources can display
    // macOS Screen Recording UI, so a status refresh must never do that.
    screen: getScreenPermissionStatus(),
  };
}

let microphonePermissionRequest = null;
async function requestMicrophoneAccess() {
  if (!isMac) return getPermissionStatus();
  if (microphonePermissionRequest) return microphonePermissionRequest;
  microphonePermissionRequest = (async () => {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus === 'not-determined') {
      await withNativeUiYield(() => systemPreferences.askForMediaAccess('microphone'));
      // The explicit microphone sheet has now completed; restore the originating
      // Clarity UI through the same coordinator, without a Dock transformation.
      returnToClarity();
    } else if (micStatus !== 'granted') {
      await yieldToExternalSettings();
      try {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone', { activate: true });
      } catch (error) {
        returnToClarity();
        throw error;
      }
    }
    return getPermissionStatus();
  })();
  try { return await microphonePermissionRequest; }
  finally { microphonePermissionRequest = null; }
}

// Compatibility check: startup and access checks never ask for permission.
async function requestPermissions() {
  const status = await getPermissionStatus();
  return status.mic === 'granted' && status.screen === 'granted';
}

function createPermissionsWindow() {
  const { workArea } = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const W = Math.min(520, workArea.width), H = Math.min(640, workArea.height);
  const parent = win && !win.isDestroyed() ? win : null;
  const parentBounds = parent ? parent.getBounds() : null;
  const x = parentBounds
    ? Math.round(parentBounds.x + (parentBounds.width - W) / 2)
    : Math.round(workArea.x + (workArea.width - W) / 2);
  const centeredY = parentBounds
    ? Math.round(parentBounds.y + (parentBounds.height - H) / 2)
    : Math.round(workArea.y + (workArea.height - H) / 2);
  const y = Math.max(
    workArea.y,
    Math.min(centeredY + 52, workArea.y + workArea.height - H)
  );

  permWin = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    // Use a normal frameless window; NSPanel activation can hide this UI
    // while the main window is being focused for Settings.
    frame: false,
    transparent: true,
    roundedCorners: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: !isForegroundYieldActive(),
    webPreferences: {
      preload: path.join(__dirname, 'preload-permissions.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });
  permWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  permWin.webContents.on('will-navigate', (event, url) => {
    if (url !== permWin.webContents.getURL()) event.preventDefault();
  });
  permWin.loadFile(path.join(__dirname, 'renderer', 'permissions.html'));
  if (!isForegroundYieldActive()) {
    permWin.setAlwaysOnTop(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL);
  }
  permWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac && typeof permWin.setHiddenInMissionControl === 'function') permWin.setHiddenInMissionControl(true);
  permWin.webContents.on('did-finish-load', () => {
    if (parent && !parent.isDestroyed()) parent.showInactive();
    if (isForegroundYieldActive()) {
      permissionsHiddenForNativeUi = true;
      permWin.setAlwaysOnTop(false);
      permWin.hide();
      return;
    }
    permWin.setAlwaysOnTop(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL);
    if (settingsPriorityActive) {
      permissionsHiddenForSettings = true;
      permWin.hide();
    } else {
      permWin.show();
      permWin.moveTop();
      permWin.focus();
    }
  });
  permWin.on('closed', () => {
    permWin = null;
    permissionsHiddenForSettings = false;
  });
}

// -------- launch --------
function launchApp() {
  if (isMac && app.dock) app.dock.hide();

  whisperModelManager = new WhisperModelManager({ userDataPath: app.getPath('userData') });
  resourceContextIndex = new ResourceContextIndex({ cachePath: path.join(app.getPath('userData'), 'resource-index.json') });
  transcriptArchive = createTranscriptArchive({ directory: path.join(app.getPath('documents'), 'Clarity Transcripts') });
  const resourceSettings = store.getSettings();
  const resourceStatus = resourceContextIndex.status(resourceSettings.resourceRepositories || []);
  if ((resourceSettings.resourceRepositories || []).length && resourceStatus.stale) {
    resourceContextIndex.refresh(resourceSettings.resourceRepositories, { githubToken: resourceSettings.githubToken || '' })
      .then((status) => send('resources:status', status))
      .catch((error) => recordEvent({ level: 'error', event: 'resource_index_failed', msg: error.message, frame: 'launchApp' }));
  }

  const isTrustedMediaRenderer = (webContents, details = {}) => {
    if (!win || win.isDestroyed() || !webContents || webContents.id !== win.webContents.id) return false;
    if (details.isMainFrame === false) return false;
    const currentUrl = webContents.getURL();
    if (!currentUrl.endsWith('/renderer/index.html')) return false;
    if (details.requestingUrl && details.requestingUrl !== currentUrl) return false;
    return true;
  };
  const allowPermissionRequest = (webContents, permission, details = {}) => {
    if (!isTrustedMediaRenderer(webContents, details)) return false;
    if (permission === 'display-capture') return true;
    if (permission !== 'media') return false;
    const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    return mediaTypes.length === 0 || (mediaTypes.includes('audio') && !mediaTypes.includes('video'));
  };
  const allowPermissionCheck = (webContents, permission, details = {}) => {
    if (!isTrustedMediaRenderer(webContents, details)) return false;
    if (permission === 'display-capture') return true;
    if (permission !== 'media') return false;
    return details.mediaType !== 'video';
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowPermissionRequest(webContents, permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    return allowPermissionCheck(webContents, permission, details);
  });

  // Keep display capture picker-free. Clarity supplies the primary display itself
  // and requests loopback audio from that source, matching the original macOS
  // capture path enabled by the Chromium feature flags above.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    if (isMac && getScreenPermissionStatus() !== 'granted') return callback();
    // Audio source selection needs display IDs, not preview images. The default
    // thumbnails perform a separate screen capture before the real stream starts.
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    }).then((sources) => {
      if (!sources.length) return callback();
      const request = { video: sources[0] };
      if (isWindows || isMac) request.audio = 'loopback';
      callback(request);
    }).catch(() => callback());
  }, { useSystemPicker: false });

  // Started before the shortcuts so their registration failures are recorded.
  startAppLink({
    snapshot: () => ({
      state,
      transcript,
      settings: store.getSettings(),
      sttDisabled,
      shortcuts: { ...shortcutState },
      windowAlive: !!(win && !win.isDestroyed()),
    }),
    setCapturing: requestCapturing,
    canPresentConsent: () => !isForegroundYieldActive(),
    // Looked up rather than captured: the window is recreated on 'activate',
    // so a reference taken at startup goes stale.
    getWindow: () => win,
  });

  createWindow();
  registerShortcuts();
}

// An explicit shortcut, activation, or second launch is a return from
// external Settings. Native permission/file sheets still keep foreground ownership.
function returnToClarity() {
  if (nativeUiDepth > 0) return;
  if (!win || win.isDestroyed()) { createWindow(); return; }
  win.setIgnoreMouseEvents(false);
  win.show();
  win.focus();
  if (externalSettingsActive) restoreAfterExternalSettings();
  else restoreAfterNativeUiYield();
  if (!isForegroundYieldActive() && permWin && !permWin.isDestroyed() && !settingsPriorityActive) {
    permWin.setAlwaysOnTop(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL);
    permWin.show();
    permWin.moveTop();
    permWin.focus();
  }
}

// -------- lifecycle --------
// Prevent stale duplicate Clarity instances from accumulating. A second launch focuses
// the existing overlay and exits immediately.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => returnToClarity());

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;

  // The main overlay owns first-run onboarding, including its permission step.
  launchApp();

  // Make sure the actual Clarity UI is painted before macOS can show its native
  // permission prompts. This keeps the permission flow visually anchored over Clarity.
  if (win && !win.isDestroyed() && win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  }

  // New users configure access inside the tutorial. Only returning users need
  // the separate permission-recovery window when access has been revoked.
  if (isMac && store.getSettings().onboarded) {
    const allGranted = await requestPermissions();
    if (!allGranted) createPermissionsWindow();
  }

  app.on('activate', () => {
    if (externalSettingsActive && Date.now() < externalSettingsRestoreAfter) return;
    returnToClarity();
  });
});

app.on('before-quit', () => {
  // macOS Privacy settings can perform its own Quit & Reopen after a grant.
  // Let that replacement instance take the lock as soon as this process starts
  // shutting down instead of making it lose the race and exit immediately.
  if (app.hasSingleInstanceLock()) app.releaseSingleInstanceLock();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Best effort, deliberately not blocking the quit: the library also removes
  // the instance file from a `process.on('exit')` handler, and a file left
  // behind is harmless anyway because readers check whether the PID is alive.
  // Delaying shutdown to tidy a directory would be the wrong trade.
  stopAppLink();
  if (whisperModelManager?.activeDownload) {
    whisperModelManager.cancelDownload(whisperModelManager.activeDownload.modelId);
  }
  if (localWhisperTranscriber) localWhisperTranscriber.forceStop().catch(() => {});
  finishTranscriptArchive();
});
app.on('window-all-closed', (e) => {
  // Don't quit while the permissions window is open — the user may be in System Settings
  if (permWin) { e.preventDefault(); return; }
  app.quit();
});
