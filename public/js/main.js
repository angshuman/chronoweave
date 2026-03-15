/* ChronoWeave -- Main Entry Point */

import { S } from './state.js';
import { _$, viewSwitch, canvasWrap, densityDropdown, modalBg, sidebar, mergeBtn } from './dom.js';
import { initTheme } from './themes.js';
import { createSession, loadSessions, setResearchFn } from './sessions.js';
import { doResearch } from './research.js';
import { doMerge } from './merge.js';
import { zoomIn, zoomOut, zoomFit } from './zoom.js';
import { setMinImportance } from './density.js';
import { renderView } from './render.js';
import { initAuth, setOnAuthChange } from './auth.js';
import { initAccountUI, renderAuth } from './account.js';

// Wire the circular dependency: sessions → research
setResearchFn(doResearch);

// Auth state changes → re-render auth UI + reload sessions
setOnAuthChange((user) => {
  renderAuth();
  loadSessions();
});

// -- Event Listeners ---------------------------------------------------------

_$("#newSessionBtn").addEventListener("click", () => createSession());

// Landing input
_$("#landingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { const q = e.target.value.trim(); if (q) createSession(q); }
});
_$("#landingSubmit").addEventListener("click", () => {
  const q = _$("#landingInput").value.trim(); if (q) createSession(q);
});

// Session query input
_$("#queryInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { const q = e.target.value.trim(); if (q) { e.target.value = ""; doResearch(q); } }
});
_$("#querySubmit").addEventListener("click", () => {
  const q = _$("#queryInput").value.trim(); if (q) { _$("#queryInput").value = ""; doResearch(q); }
});

mergeBtn.addEventListener("click", doMerge);
_$("#mobileToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
_$("#mClose").addEventListener("click", () => modalBg.classList.add("hidden"));
modalBg.addEventListener("click", e => { if (e.target === modalBg) modalBg.classList.add("hidden"); });

// View switch
viewSwitch.querySelectorAll(".vs-btn").forEach(b => b.addEventListener("click", () => {
  viewSwitch.querySelectorAll(".vs-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  S.view = b.dataset.view;
  renderView();
}));

// Zoom controls
_$("#zoomIn").addEventListener("click", zoomIn);
_$("#zoomOut").addEventListener("click", zoomOut);
_$("#zoomFit").addEventListener("click", zoomFit);

// Mouse wheel zoom on canvas
canvasWrap.addEventListener("wheel", e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }
}, { passive: false });

// Density dropdown
_$("#densityBtn").addEventListener("click", e => {
  e.stopPropagation();
  densityDropdown.classList.toggle("hidden");
});
densityDropdown.querySelectorAll(".dd-item").forEach(b => b.addEventListener("click", () => {
  setMinImportance(parseInt(b.dataset.min));
  densityDropdown.classList.add("hidden");
}));
document.addEventListener("click", () => densityDropdown.classList.add("hidden"));

// Check for payment success/cancel in URL
function checkPaymentStatus() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") === "success") {
    const credits = params.get("credits");
    const toast = document.createElement("div");
    toast.className = "cw-toast cw-toast-show";
    toast.textContent = `Payment successful! ${credits} credits added.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
  } else if (params.get("payment") === "cancelled") {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

// -- Init -------------------------------------------------------------------
initTheme();
lucide.createIcons();
initAccountUI();
initAuth().then(() => {
  loadSessions();
  checkPaymentStatus();
});
