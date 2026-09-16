// Plain-text transcript archiving for each listening session.
// Files are updated after every finalized turn so a crash cannot lose the whole session.
'use strict';

const fs = require('fs');
const path = require('path');

function fileStamp(ms) {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

function createTranscriptArchive({ directory, now = Date.now } = {}) {
  if (!directory) throw new Error('Transcript archive requires a directory.');
  let current = null;

  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  function uniqueFile(startedAt) {
    const base = `clarity-transcript-${fileStamp(startedAt)}`;
    let candidate = path.join(directory, `${base}.txt`);
    let suffix = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(directory, `${base}-${suffix}.txt`);
      suffix += 1;
    }
    return candidate;
  }

  return {
    get directory() { return directory; },
    get current() { return current ? { ...current } : null; },

    ensureDirectory,

    start(startedAt = now()) {
      ensureDirectory();
      if (current) this.finish(startedAt);
      const file = uniqueFile(startedAt);
      fs.writeFileSync(file, `Clarity transcript\nStarted: ${new Date(startedAt).toISOString()}\n\n`, { encoding: 'utf8', mode: 0o600 });
      current = { file, startedAt };
      return { ...current };
    },

    append(turn) {
      if (!current || !turn || !turn.text) return false;
      const speaker = turn.channel === 'them' ? 'Them' : 'You';
      const stamp = new Date(Number(turn.ts) || now()).toISOString();
      const text = String(turn.text).replace(/\s+/g, ' ').trim();
      if (!text) return false;
      fs.appendFileSync(current.file, `[${stamp}] ${speaker}: ${text}\n`, 'utf8');
      return true;
    },

    remove(turn) {
      if (!current || !turn?.text) return false;
      const stamp = new Date(Number(turn.ts) || now()).toISOString();
      const text = String(turn.text).replace(/\s+/g, ' ').trim();
      const line = `[${stamp}] ${turn.channel === 'them' ? 'Them' : 'You'}: ${text}\n`;
      const contents = fs.readFileSync(current.file, 'utf8');
      const at = contents.indexOf(line);
      if (at < 0) return false;
      fs.writeFileSync(current.file, contents.slice(0, at) + contents.slice(at + line.length), 'utf8');
      return true;
    },

    finish(endedAt = now()) {
      if (!current) return null;
      const finished = { ...current, endedAt };
      current = null;
      fs.appendFileSync(finished.file, `\nEnded: ${new Date(endedAt).toISOString()}\n`, 'utf8');
      return finished;
    }
  };
}

module.exports = { createTranscriptArchive, fileStamp };
