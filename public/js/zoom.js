/* ChronoWeave -- Zoom Controls */

import { S, ZOOM_STEPS } from './state.js';
import { zoomLevelEl } from './dom.js';
import { renderView } from './render.js';

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
