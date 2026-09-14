const test = require('node:test');
const assert = require('node:assert/strict');
const { isLikelyInterviewQuestion, collectRecentInterviewerQuestion, isLikelyTranscriptEcho } = require('../src/live-answer');

test('detects common interview questions even when STT omits punctuation', () => {
  assert.equal(isLikelyInterviewQuestion('Tell me about a time you handled conflict'), true);
  assert.equal(isLikelyInterviewQuestion('How would you design a rate limiter'), true);
  assert.equal(isLikelyInterviewQuestion('Thanks for explaining that'), false);
});

test('combines adjacent interviewer fragments into one question', () => {
  const turns = [
    { channel: 'you', text: 'Sure.', ts: 1000 },
    { channel: 'them', text: 'Tell me about a time', ts: 2000 },
    { channel: 'them', text: 'you had to resolve a disagreement.', ts: 2600 }
  ];
  assert.equal(
    collectRecentInterviewerQuestion(turns),
    'Tell me about a time you had to resolve a disagreement.'
  );
});

test('does not cross candidate turns when collecting a question', () => {
  const turns = [
    { channel: 'them', text: 'Earlier question', ts: 1000 },
    { channel: 'you', text: 'My answer', ts: 2000 },
    { channel: 'them', text: 'Why this role', ts: 3000 }
  ];
  assert.equal(collectRecentInterviewerQuestion(turns), 'Why this role');
});

test('detects a mic echo even when Whisper appends a few extra words', () => {
  assert.equal(
    isLikelyTranscriptEcho(
      'What is the difference between an array and a linked list? you Yo. you you',
      'What is the difference between an array and a linked list?'
    ),
    true
  );
});

test('does not treat a genuine candidate response as mic echo', () => {
  assert.equal(
    isLikelyTranscriptEcho(
      'Arrays give constant-time indexed access, while linked lists make insertion easier when you already have the node.',
      'What is the difference between an array and a linked list?'
    ),
    false
  );
});
