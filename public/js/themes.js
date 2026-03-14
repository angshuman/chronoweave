/* ChronoWeave -- Theme System */

import { S } from './state.js';
import { storeSet, storeGet } from './api.js';

export function setTheme(name) {
  S.theme = name;
  document.documentElement.setAttribute("data-theme", name);
  document.querySelectorAll(".theme-dot").forEach(d => {
    d.classList.toggle("active", d.dataset.theme === name);
  });
  storeSet("chronoweave-theme", name);
}

export function initTheme() {
  const saved = storeGet("chronoweave-theme");
  setTheme(saved || "midnight");
}

// Bind theme dot clicks
document.querySelectorAll(".theme-dot").forEach(dot => {
  dot.addEventListener("click", () => setTheme(dot.dataset.theme));
});
