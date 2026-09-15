function nextZoomFactor(input, current, isMac) {
  if (input.type !== 'keyDown' || !(isMac ? input.meta : input.control) || input.alt) return null;
  if (input.key === '0') return 1;
  const direction = ['+', '='].includes(input.key) ? 1 : input.key === '-' ? -1 : 0;
  return direction ? Math.max(0.6, Math.min(1.7, Math.round((current + direction * 0.1) * 10) / 10)) : null;
}
module.exports = { nextZoomFactor };
