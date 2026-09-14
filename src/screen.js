// Full-resolution screenshot via desktopCapturer (main process). The main
// process checks macOS Screen & System Audio Recording permission before this
// function is called, so capture itself never becomes an accidental permission
// prompt path.
const { desktopCapturer, screen } = require('electron');

async function captureScreenshot(preferredDisplayId = null) {
  const displays = screen.getAllDisplays();
  const preferred = displays.find((display) => String(display.id) === String(preferredDisplayId));
  const target = preferred || screen.getPrimaryDisplay();
  const { width, height } = target.size;
  const scale = target.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.floor(width * scale), height: Math.floor(height * scale) }
  });
  if (!sources.length) return null;
  const src = sources.find((s) => String(s.display_id) === String(target.id)) || sources[0];
  const img = src.thumbnail;
  if (!img || img.isEmpty()) return null;
  return img.toDataURL(); // data:image/png;base64,...
}

module.exports = { captureScreenshot };
