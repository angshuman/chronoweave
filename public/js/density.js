/* ChronoWeave -- Density Controls */

import { S } from './state.js';
import { densityDropdown, densityLabel } from './dom.js';
import { renderView } from './render.js';

export function setMinImportance(min) {
  S.minImportance = min;
  densityDropdown.querySelectorAll(".dd-item").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.min) === min);
  });
  const labels = { 0: "All", 3: "3+", 5: "5+", 7: "7+", 9: "9+" };
  densityLabel.textContent = labels[min] || "All";
  renderView();
}
