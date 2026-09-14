const path = require('path');

const WHISPER_CPP_VERSION = '1.9.1';
const RELEASE_BASE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/v${WHISPER_CPP_VERSION}`;
const SOURCE_REPOSITORY_URL = 'https://github.com/ggml-org/whisper.cpp.git';
// Pin the exact commit behind v1.9.1 instead of hashing GitHub's generated
// source ZIP. GitHub may recompress those ZIPs without changing source, which
// made otherwise identical macOS builds fail checksum verification.
const SOURCE_COMMIT = 'f049fff95a089aa9969deb009cdd4892b3e74916';

const RUNTIME_TARGETS = Object.freeze({
  'win32-x64': Object.freeze({
    kind: 'archive',
    archiveType: 'zip',
    filename: 'whisper-bin-x64.zip',
    bytes: 7982101,
    sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539',
    executable: 'whisper-server.exe'
  }),
  'linux-x64': Object.freeze({
    kind: 'archive',
    archiveType: 'tar.gz',
    filename: 'whisper-bin-ubuntu-x64.tar.gz',
    bytes: 9379235,
    sha256: 'f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5',
    executable: 'whisper-server'
  }),
  'linux-arm64': Object.freeze({
    kind: 'archive',
    archiveType: 'tar.gz',
    filename: 'whisper-bin-ubuntu-arm64.tar.gz',
    bytes: 4555819,
    sha256: 'e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3',
    executable: 'whisper-server'
  }),
  'darwin-x64': Object.freeze({
    kind: 'source',
    sourceArchitecture: 'x86_64',
    executable: 'whisper-server'
  }),
  'darwin-arm64': Object.freeze({
    kind: 'source',
    sourceArchitecture: 'arm64',
    executable: 'whisper-server'
  })
});

function getRuntimeTarget(platform = process.platform, architecture = process.arch) {
  const key = `${platform}-${architecture}`;
  const target = RUNTIME_TARGETS[key];
  if (!target) throw new Error(`Local Whisper is not packaged for ${key}.`);
  if (target.kind === 'archive') {
    return { ...target, key, url: `${RELEASE_BASE_URL}/${target.filename}` };
  }
  return { ...target, key, repositoryUrl: SOURCE_REPOSITORY_URL, commit: SOURCE_COMMIT };
}

function getRuntimeExecutablePath(runtimeDirectory, platform = process.platform, architecture = process.arch) {
  return path.join(runtimeDirectory, getRuntimeTarget(platform, architecture).executable);
}

module.exports = {
  WHISPER_CPP_VERSION,
  RUNTIME_TARGETS,
  SOURCE_REPOSITORY_URL,
  SOURCE_COMMIT,
  getRuntimeTarget,
  getRuntimeExecutablePath
};
