function compactPermissions(permissions = {}) {
  return {
    microphone: permissions.mic || 'unknown',
    screen: permissions.screen || 'unknown',
  };
}

function configuredCredentials(apiKeys = {}) {
  return Object.fromEntries(
    Object.entries(apiKeys).map(([provider, value]) => [provider, !!String(value || '').trim()])
  );
}

function buildDiagnosticSnapshot({
  appVersion,
  platform,
  release,
  arch,
  electron,
  chrome,
  settings = {},
  permissions = {},
  state = {},
  transcriptTurns = 0,
  sttDisabled = false,
  shortcuts = {},
  resources = null,
  whisperRuntime = null,
  windows = null,
}) {
  const provider = settings.provider || 'unknown';
  const models = settings.models?.[provider] || {};
  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: 'Clarity',
      version: String(appVersion || 'unknown'),
    },
    system: {
      platform: platform || 'unknown',
      release: release || 'unknown',
      arch: arch || 'unknown',
      electron: electron || 'unknown',
      chrome: chrome || 'unknown',
      ...(windows ? { windows } : {}),
    },
    permissions: compactPermissions(permissions),
    capture: {
      active: !!state.capturing,
      busy: !!state.busy,
      transcribing: {
        you: !!state.transcribing?.you,
        them: !!state.transcribing?.them,
      },
      transcriptionDisabled: !!sttDisabled,
      transcriptTurns: Math.max(0, Number(transcriptTurns) || 0),
    },
    ai: {
      provider,
      smart: !!settings.smart,
      modelFast: models.fast || null,
      modelSmart: models.smart || null,
      configuredCredentials: configuredCredentials(settings.apiKeys),
    },
    speech: {
      provider: settings.sttProvider || 'auto',
      localModel: settings.localWhisper?.modelId || null,
      runtime: whisperRuntime
        ? {
            available: !!whisperRuntime.available,
            version: whisperRuntime.version || null,
            target: whisperRuntime.target || null,
          }
        : null,
    },
    storage: {
      saveTranscripts: !!settings.saveTranscripts,
      connectedRepositories: Array.isArray(settings.resourceRepositories)
        ? settings.resourceRepositories.length
        : 0,
    },
    resources: resources
      ? {
          configured: Number(resources.configured) || 0,
          indexed: Number(resources.indexed) || 0,
          files: Number(resources.files) || 0,
          chunks: Number(resources.chunks) || 0,
          stale: !!resources.stale,
          errors: Array.isArray(resources.errors) ? resources.errors.length : 0,
        }
      : null,
    shortcuts: { ...shortcuts },
  };
}

function formatDiagnosticReport(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

module.exports = { buildDiagnosticSnapshot, formatDiagnosticReport };
