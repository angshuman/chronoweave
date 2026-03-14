/* ChronoWeave -- Density Controls */

import { S } from './state.js';
import { renderView } from './render.js';

export function initDensity() {
  const slider = document.getElementById('densitySlider');
  const val    = document.getElementById('densityVal');
  if (!slider) return;

  slider.addEventListener('input', () => {
    S.minImportance = +slider.value;
    if (val) val.textContent = slider.value;
    renderView();
  });
}
