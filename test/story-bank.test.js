const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStoryBank, splitGroundedChunks } = require('../src/story-bank');

test('story bank prefers a matching grounded STAR story', () => {
  const starStories = [
    'At PayCo I led an outage response, found Redis exhaustion, and restored service in 12 minutes.',
    '',
    'On a redesign, I disagreed with a teammate about the API shape. I brought latency data to the discussion and we agreed on a simpler interface.'
  ].join('\n');
  const stories = buildStoryBank({
    question: 'Tell me about a time you disagreed with a teammate.',
    starStories,
    resumeText: 'Engineer at PayCo. Built payment services.'
  });
  assert.match(stories[0].text, /disagreed with a teammate/i);
  assert.equal(stories[0].source, 'star');
});

test('story bank falls back to resume evidence without manufacturing events', () => {
  const stories = buildStoryBank({
    question: 'Tell me about a challenging technical project.',
    resumeText: 'Projects\nBuilt a streaming fraud detection pipeline in Python and Kafka.\nEducation\nState University',
    starStories: ''
  });
  assert.ok(stories.length > 0);
  assert.equal(stories[0].source, 'resume');
  assert.match(stories[0].text, /fraud detection pipeline/i);
});

test('splitGroundedChunks ignores tiny headings', () => {
  assert.deepEqual(splitGroundedChunks('Projects\nBuilt a useful system for production traffic.'), [
    'Built a useful system for production traffic.'
  ]);
});
