/* ChronoWeave -- Zoom Controls */

import { S, ZOOM_STEPS } from './state.js';
import { zoomLevelEl } from './dom.js';
import { renderView } from './render.js';

/**
 * Calculate automatic importance threshold based on zoom level.
 * As the user zooms out, less important events are hidden.
 * Returns 0 (show all) at 100%+, escalating to 9 at 20% or below.
 */
export function autoImportanceThreshold(zoom) {
  if (zoom >= 0.95) return 0;   // 100%+ → show all
  if (zoom >= 0.70) return 3;   // ~75% → hide < 3
  if (zoom >= 0.45) return 5;   // ~50% → hide < 5
  if (zoom >= 0.25) return 7;   // ~30% → hide < 7
  return 9;                     // 20% or less → only critical
}

export function setZoom(z) {
  S.zoom = Math.max(0.15, Math.min(5, z));
  zoomLevelEl.textContent = Math.round(S.zoom * 100) + "%";
  renderView();
}

export function zoomIn() {
  const next = ZOOM_STEPS.find(s => s > S.zoom + 0.01);
  setZoom(next || S.zoom);
}

export function zoomOut() {
  const prev = [...ZOOM_STEPS].reverse().find(s => s < S.zoom - 0.01);
  setZoom(prev || S.zoom);
}

export function zoomFit() { setZoom(1.0); }
