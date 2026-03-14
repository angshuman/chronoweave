/* ChronoWeave -- Main Entry Point */

import { S } from './state.js';
import { loadPref, savePref } from './api.js';
import { initSessions, loadSession } from './sessions.js';
import { initThemes } from './themes.js';
import { initZoom } from './zoom.js';
import { initDensity } from './density.js';
import { initModal } from './modal.js';
import { initMerge } from './merge.js';
import { initReasoning } from './reasoning.js';
import { renderView } from './render.js';
import {
  researchForm, researchInput, btnResearch,
  controlsBar, landing, viewContainer,
  btnMerge,
} from './dom.js';

// ---- Init sub-systems ----
initThemes();
initSessions();
initZoom();
initDensity();
initModal();
initMerge();
initReasoning();

// ---- Research form ----
researchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = researchInput.value.trim();
  if (!q || !S.sessionId) return;
  researchInput.value = '';
  await import('./research.js').then(m => m.doResearch(q));
});

// ---- Gap crop toggle ----
const gapToggle = document.getElementById('gapToggle');
if (gapToggle) {
  gapToggle.checked = loadPref('gapCrop', true);
  S.gapCrop = gapToggle.checked;
  gapToggle.addEventListener('change', () => {
    S.gapCrop = gapToggle.checked;
    savePref('gapCrop', S.gapCrop);
    renderView();
  });
}

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('modalBg')?.classList.add('hidden');
  }
});

// ---- Restore last session ----
const lastSid = loadPref('lastSession', null);
if (lastSid) loadSession(lastSid);
