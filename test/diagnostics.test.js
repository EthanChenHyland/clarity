const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDiagnosticSnapshot, formatDiagnosticReport } = require('../src/diagnostics');

test('diagnostics expose useful state without copying secrets or transcript content', () => {
  const snapshot = buildDiagnosticSnapshot({
    appVersion: '0.2.16',
    platform: 'darwin',
    release: '24.5.0',
    arch: 'arm64',
    electron: '44.3.0',
    chrome: '146.0',
    settings: {
      provider: 'custom',
      smart: true,
      sttProvider: 'local',
      saveTranscripts: false,
      apiKeys: { custom: 'secret-key', openai: '' },
      models: { custom: { fast: 'fast/model', smart: 'smart/model' } },
      localWhisper: { modelId: 'small.en' },
      resourceRepositories: ['https://github.com/example/private'],
      githubToken: 'github-secret',
      resumeText: 'private resume',
    },
    permissions: { mic: 'granted', screen: 'denied' },
    state: { capturing: true, busy: false, transcribing: { you: true, them: false } },
    transcriptTurns: 42,
    sttDisabled: false,
    shortcuts: { assist: true, say: false },
  });
  const report = formatDiagnosticReport(snapshot);

  assert.equal(snapshot.ai.configuredCredentials.custom, true);
  assert.equal(snapshot.ai.configuredCredentials.openai, false);
  assert.equal(snapshot.capture.transcriptTurns, 42);
  assert.equal(snapshot.storage.connectedRepositories, 1);
  assert.doesNotMatch(report, /secret-key|github-secret|private resume|example\/private/);
  assert.match(report, /fast\/model/);
  assert.match(report, /"screen": "denied"/);
});
