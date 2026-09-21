const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

contextBridge.exposeInMainWorld('clarity', {
  platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  whisperModels: () => ipcRenderer.invoke('whisper:models'),
  whisperModelDownload: (modelId) => ipcRenderer.invoke('whisper:model-download', modelId),
  whisperModelCancel: (modelId) => ipcRenderer.invoke('whisper:model-cancel', modelId),
  whisperModelDelete: (modelId) => ipcRenderer.invoke('whisper:model-delete', modelId),
  whisperModelImport: (modelId) => ipcRenderer.invoke('whisper:model-import', modelId),
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  stopResponse: () => ipcRenderer.send('llm:stop'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  captureToggle: () => ipcRenderer.invoke('capture:toggle').catch((err) => {
    console.error('[clarity] captureToggle error', err);
    return false;
  }),
  captureState: () => ipcRenderer.invoke('capture:state'),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  dragWindow: (phase) => ipcRenderer.send('window:drag', phase),
  setIgnoreMouse: (v, toolbar) => ipcRenderer.send('mouse:ignore', v, toolbar),
  setSettingsPriority: (open) => ipcRenderer.send('window:settings-priority', !!open),
  beginNativePermissionPrompt: () => ipcRenderer.invoke('native-permission-prompt:begin'),
  endNativePermissionPrompt: () => ipcRenderer.invoke('native-permission-prompt:end'),
  beginSystemAudioPermissionPrompt: () => ipcRenderer.invoke('system-audio-permission-prompt:begin'),
  endSystemAudioPermissionPrompt: () => ipcRenderer.invoke('system-audio-permission-prompt:end'),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  openTranscriptFolder: () => ipcRenderer.invoke('transcript:open-folder'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  appLinkState: () => ipcRenderer.invoke('applink:state'),
  appLinkRevoke: (callerId) => ipcRenderer.invoke('applink:revoke', callerId),
  appLinkConsentRespond: (id, allowed) => ipcRenderer.send('applink:consent-response', { id, allowed }),
  pickProfileDocument: () => ipcRenderer.invoke('profile:pickDocument'),
  quit: () => ipcRenderer.send('app:quit'),
  restartApp: () => ipcRenderer.send('permissions:restart-app'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('permissions:microphone'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  permissionsRequest: () => ipcRenderer.invoke('permissions:request'),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['mouse:interactive', 'capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'transcript:sync', 'stt:interim', 'stt:final', 'stt:status', 'vad:state', 'applink:consent-request', 'hide:toggle', 'settings:open', 'whisper:download-progress', 'whisper:models-changed'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
