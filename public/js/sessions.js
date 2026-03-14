/* ChronoWeave — Sessions & Timelines */

import { S } from './state.js';
import { sessionNav, topbarTitle, landing, sessionView, chipsBar, mergeBtn, sidebar } from './dom.js';
import { api, showLoader, hideLoader } from './api.js';
import { esc, hexAlpha } from './utils.js';
import { renderView } from './render.js';
import { resetColorIdx } from './state.js';

// Lazy reference to doResearch — set via setResearchFn to break circular dep
let _doResearch = null;
export function setResearchFn(fn) { _doResearch = fn; }

// ── Sessions ───────────────────────────────────────────────────────────────────────

export async function loadSessions() {
  S.sessions = await api("/api/sessions");
  renderSessions();
}

export function renderSessions() {
  sessionNav.innerHTML = "";
  if (!S.sessions.length) {
    sessionNav.innerHTML = '<div class="empty-note" style="padding:20px;font-size:12px">No threads yet</div>';
    return;
  }
  S.sessions.forEach(s => {
    const el = document.createElement("div");
    el.className = `nav-item${s.id === S.activeId ? " active" : ""}`;
    el.innerHTML = `<span class="nav-name">${esc(s.name)}</span><span class="nav-count">${s.timeline_count || 0}</span><button class="nav-del" data-id="${s.id}" aria-label="Delete"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>`;
    el.addEventListener("click", e => { if (e.target.closest(".nav-del")) return; selectSession(s.id); });
    el.querySelector(".nav-del").addEventListener("click", async e => {
      e.stopPropagation();
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      if (S.activeId === s.id) { S.activeId = null; S.timelines = []; showLanding(); }
      await loadSessions();
    });
    sessionNav.appendChild(el);
  });
  lucide.createIcons({ nodes: [sessionNav] });
}

export async function createSession(initialQuery) {
  const name = initialQuery ? initialQuery.slice(0, 50) : `Thread ${S.sessions.length + 1}`;
  const s = await api("/api/sessions", { method: "POST", body: JSON.stringify({ name }) });
  await loadSessions();
  await selectSession(s.id);
  if (initialQuery && _doResearch) await _doResearch(initialQuery);
}

export async function selectSession(id) {
  S.activeId = id;
  S.selected.clear();
  resetColorIdx();
  const sess = S.sessions.find(s => s.id === id);
  topbarTitle.textContent = sess ? sess.name : "Thread";
  landing.classList.add("hidden");
  sessionView.classList.remove("hidden");
  await loadTimelines();
  renderSessions();
  sidebar.classList.remove("open");
}

export function showLanding() {
  landing.classList.remove("hidden");
  sessionView.classList.add("hidden");
}

// ── Timelines ───────────────────────────────────────────────────────────────────────

export async function loadTimelines() {
  if (!S.activeId) return;
  S.timelines = await api(`/api/sessions/${S.activeId}/timelines`);
  renderChips();
  renderView();
}

export function renderChips() {
  chipsBar.innerHTML = "";
  S.timelines.forEach(tl => {
    const sel = S.selected.has(tl.id);
    const ch = document.createElement("div");
    ch.className = `chip${sel ? " selected" : ""}`;
    ch.style.background = sel ? "" : hexAlpha(tl.color, 0.12);
    ch.style.color = tl.color;
    let extra = "";
    if (tl.is_merged) extra = '<span class="chip-badge">merged</span>';
    ch.innerHTML = `<span class="cdot" style="background:${tl.color}"></span><span>${esc(tl.name)}</span>${extra}${tl.is_merged ? `<button class="chip-act" data-act="unmerge" data-id="${tl.id}"><i data-lucide="split" style="width:10px;height:10px"></i></button>` : ""}<button class="chip-act" data-act="del" data-id="${tl.id}"><i data-lucide="x" style="width:10px;height:10px"></i></button>`;
    ch.addEventListener("click", e => { if (e.target.closest("[data-act]")) return; toggleSelect(tl.id); });
    ch.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async e => {
      e.stopPropagation();
      if (b.dataset.act === "del") {
        await api(`/api/timelines/${b.dataset.id}`, { method: "DELETE" });
        S.selected.delete(b.dataset.id);
        await loadTimelines();
      } else if (b.dataset.act === "unmerge") {
        showLoader("Unmerging...");
        await api("/api/unmerge", { method: "POST", body: JSON.stringify({ timeline_id: b.dataset.id }) });
        S.selected.delete(b.dataset.id);
        hideLoader();
        await loadTimelines();
      }
    }));
    chipsBar.appendChild(ch);
  });
  lucide.createIcons({ nodes: [chipsBar] });
  mergeBtn.disabled = S.selected.size < 2;
}

function toggleSelect(id) {
  S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
  renderChips();
}
