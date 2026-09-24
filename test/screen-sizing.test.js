const test = require('node:test');
const assert = require('node:assert/strict');
const { screenshotThumbnailSize } = require('../src/screen-sizing');

test('caps Retina screenshots while preserving aspect ratio', () => {
  const size = screenshotThumbnailSize({
    size: { width: 1512, height: 982 },
    scaleFactor: 2,
  });
  assert.deepEqual(size, { width: 2048, height: 1330 });
});

test('does not upscale displays already below the screenshot cap', () => {
  assert.deepEqual(
    screenshotThumbnailSize({ size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
    { width: 1920, height: 1080 }
  );
});
