/* ChronoWeave -- Zoom Controls */

import { S } from './state.js';
import { renderView } from './render.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const STEP = 0.25;

export function initZoom() {
  const btnIn  = document.getElementById('btnZoomIn');
  const btnOut = document.getElementById('btnZoomOut');
  const label  = document.getElementById('zoomLabel');
  if (!btnIn) return;

  btnIn.addEventListener('click', () => adjust(STEP));
  btnOut.addEventListener('click', () => adjust(-STEP));

  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjust(e.deltaY < 0 ? STEP : -STEP);
  }, { passive: false });

  function adjust(delta) {
    S.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, S.zoom + delta));
    label.textContent = Math.round(S.zoom * 100) + '%';
    renderView();
  }
}
