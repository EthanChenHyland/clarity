const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTranscriptArchive } = require('../src/transcript-archive');

test('saves finalized transcript turns to a readable text file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-transcripts-'));
  const start = Date.parse('2026-09-13T19:00:00.000Z');
  const archive = createTranscriptArchive({ directory: dir, now: () => start });
  const session = archive.start();
  archive.append({ channel: 'them', text: 'Tell me about yourself.', ts: start + 1000 });
  archive.append({ channel: 'you', text: 'I am a software engineer.', ts: start + 2000 });
  archive.finish(start + 3000);

  const text = fs.readFileSync(session.file, 'utf8');
  assert.match(text, /Them: Tell me about yourself\./);
  assert.match(text, /You: I am a software engineer\./);
  assert.match(text, /Started:/);
  assert.match(text, /Ended:/);
});

test('creates a new file for each listening session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-transcripts-'));
  const start = Date.parse('2026-09-13T19:00:00.000Z');
  const archive = createTranscriptArchive({ directory: dir, now: () => start });
  const first = archive.start();
  archive.finish(start + 1);
  const second = archive.start();
  assert.notEqual(first.file, second.file);
  assert.equal(fs.readdirSync(dir).length, 2);
});
