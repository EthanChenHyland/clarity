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

test('behavioral question stems do not fire before the interviewer finishes the scenario', () => {
  for (const question of [
    'Tell me about a time you',
    'Tell me about a time you had',
    'Describe a situation where you were'
  ]) {
    const shape = analyzeQuestionCompleteness(question);
    assert.equal(shape.complete, false, question);
    assert.equal(shape.trailingIncomplete, true, question);
    assert.equal(liveAnswerDelayMs({ question, source: 'interim', streamingMode: true }), 900, question);
  }
});

test('short complete follow-up what about you remains responsive', () => {
  const shape = analyzeQuestionCompleteness('What about you?');
  assert.equal(shape.shortFollowup, true);
  assert.equal(shape.trailingIncomplete, false);
  assert.equal(liveAnswerDelayMs({ question: 'What about you?', source: 'interim', streamingMode: true }), 420);
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
