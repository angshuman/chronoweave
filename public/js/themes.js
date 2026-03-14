/* ChronoWeave -- Theme Switching */

import { loadPref, savePref } from './api.js';

export function initThemes() {
  const saved = loadPref('theme', 'midnight');
  applyTheme(saved);

  document.querySelectorAll('.theme-dot').forEach(btn => {
    const t = btn.dataset.theme;
    if (t === saved) btn.classList.add('active');
    btn.addEventListener('click', () => {
      applyTheme(t);
      savePref('theme', t);
      document.querySelectorAll('.theme-dot').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === t);
      });
    });
  });
}

function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
}
