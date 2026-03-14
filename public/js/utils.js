/* ChronoWeave -- Utility Helpers */

/**
 * Escape HTML special characters.
 */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert hex color + alpha (0-1) to rgba string.
 * e.g. hexAlpha('#6e7bf2', 0.2) -> 'rgba(110,123,242,0.2)'
 */
export function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
