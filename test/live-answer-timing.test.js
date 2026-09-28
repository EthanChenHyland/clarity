const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeQuestionCompleteness, liveAnswerDelayMs } = require('../src/live-answer-timing');

test('complete finalized streaming questions trigger quickly', () => {
  assert.equal(liveAnswerDelayMs({
    question: 'Why do you want to work here?',
    source: 'final',
    streamingMode: true,
    configuredDelayMs: 800
  }), 220);
});

test('short interim follow-ups remain responsive without firing instantly', () => {
  assert.equal(liveAnswerDelayMs({
    question: 'Tell me more',
    source: 'interim',
    streamingMode: true
  }), 420);
});

test('incomplete interim questions wait for the rest of the utterance', () => {
  const shape = analyzeQuestionCompleteness('How did you deal with the');
  assert.equal(shape.complete, false);
  assert.equal(shape.trailingIncomplete, true);
  assert.equal(liveAnswerDelayMs({
    question: 'How did you deal with the',
    source: 'interim',
    streamingMode: true
  }), 900);
});

test('complete batch questions can beat a conservative configured delay', () => {
  assert.equal(liveAnswerDelayMs({
    question: 'Can you explain your project',
    source: 'final',
    streamingMode: false,
    configuredDelayMs: 800
  }), 620);
});

test('unclear batch fragments preserve the configured delay', () => {
  assert.equal(liveAnswerDelayMs({
    question: 'random incomplete',
    source: 'final',
    streamingMode: false,
    configuredDelayMs: 800
  }), 800);
});
