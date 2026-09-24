const DEFAULT_MAX_SCREEN_EDGE = 2048;

function screenshotThumbnailSize(display, maxEdge = DEFAULT_MAX_SCREEN_EDGE) {
  const width = Math.max(1, Number(display?.size?.width) || 1);
  const height = Math.max(1, Number(display?.size?.height) || 1);
  const scaleFactor = Math.max(1, Number(display?.scaleFactor) || 1);
  const physicalWidth = width * scaleFactor;
  const physicalHeight = height * scaleFactor;
  const longest = Math.max(physicalWidth, physicalHeight);
  const scale = Math.min(1, maxEdge / longest);
  return {
    width: Math.max(1, Math.round(physicalWidth * scale)),
    height: Math.max(1, Math.round(physicalHeight * scale)),
  };
}

module.exports = { DEFAULT_MAX_SCREEN_EDGE, screenshotThumbnailSize };
