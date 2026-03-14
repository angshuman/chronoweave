/* ChronoWeave -- Session & Timeline Management */

import { S } from './state.js';
import { apiFetch, savePref } from './api.js';
import { renderView } from './render.js';
import {
  sessionList, btnNewSession, topbarTitle,
  controlsBar, landing, chipScroll, btnMerge,
} from './dom.js';

// ---- Session list --------------------------------------------------------

export async function initSessions() {
  btnNewSession.addEventListener('click', createSession);
  await refreshSessions();
}

async function refreshSessions() {
  const sessions = await apiFetch('/api/sessions');
  renderSessionList(sessions);
}

function renderSessionList(sessions) {
  sessionList.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === S.sessionId ? ' active' : '');
    item.dataset.id = s.id;
    item.innerHTML = `
      <span class="session-name" title="${esc(s.name)}">${esc(s.name)}</span>
      <span class="session-count">${s.timeline_count || 0}</span>
      <button class="session-del" title="Delete session" data-id="${s.id}">x</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.session-del')) return;
      loadSession(s.id);
    });
    // Double-click to rename
    item.querySelector('.session-name').addEventListener('dblclick', () => startRename(item, s));
    // Delete
    item.querySelector('.session-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });
    sessionList.appendChild(item);
  });
}

async function createSession() {
  const s = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'New Session' }) });
  await refreshSessions();
  loadSession(s.id);
}

async function deleteSession(id) {
  await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (S.sessionId === id) {
    S.sessionId = null;
    S.timelines = [];
    S.visibleTimelines = [];
    S.selectedTimelines = new Set();
    topbarTitle.textContent = 'ChronoWeave';
    controlsBar.classList.add('hidden');
    landing.classList.remove('hidden');
    chipScroll.innerHTML = '';
  }
  await refreshSessions();
}

function startRename(item, session) {
  const nameSpan = item.querySelector('.session-name');
  const input = document.createElement('input');
  input.className = 'session-name-input';
  input.value = session.name;
  item.replaceChild(input, nameSpan);
  input.focus();
  input.select();

  const finish = async () => {
    const newName = input.value.trim() || session.name;
    await apiFetch(`/api/sessions/${session.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });
    await refreshSessions();
    if (S.sessionId === session.id) topbarTitle.textContent = newName;
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

// ---- Load session --------------------------------------------------------

export async function loadSession(id) {
  S.sessionId = id;
  S.timelines = [];
  S.visibleTimelines = [];
  S.selectedTimelines = new Set();
  savePref('lastSession', id);

  // Mark active in sidebar
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  const sessions = await apiFetch('/api/sessions');
  const sess = sessions.find(s => s.id === id);
  if (sess) topbarTitle.textContent = sess.name;

  const timelines = await apiFetch(`/api/sessions/${id}/timelines`);
  S.timelines = timelines;
  S.visibleTimelines = timelines.map(t => t.id);

  if (timelines.length) {
    controlsBar.classList.remove('hidden');
    landing.classList.add('hidden');
  } else {
    controlsBar.classList.add('hidden');
    landing.classList.remove('hidden');
  }

  renderChips();
  renderView();
}

// ---- Chips ---------------------------------------------------------------

export function renderChips() {
  chipScroll.innerHTML = '';
  S.timelines.forEach(tl => {
    const chip = document.createElement('div');
    chip.className = 'chip' +
      (S.visibleTimelines.includes(tl.id) ? '' : ' dim') +
      (S.selectedTimelines.has(tl.id) ? ' selected' : '') +
      (tl.is_merged ? ' merged-chip' : '');
    chip.dataset.id = tl.id;
    chip.innerHTML = `
      <span class="dot" style="background:${tl.color}"></span>
      <span class="truncate" title="${esc(tl.name)}">${esc(tl.name)}</span>
      <span class="chip-del" title="Remove timeline">x</span>
    `;
    // Toggle visibility
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.chip-del')) return;
      // Ctrl/Cmd = select for merge
      if (e.ctrlKey || e.metaKey) {
        if (S.selectedTimelines.has(tl.id)) S.selectedTimelines.delete(tl.id);
        else S.selectedTimelines.add(tl.id);
        updateMergeBtn();
        renderChips();
        return;
      }
      // Toggle visibility
      const idx = S.visibleTimelines.indexOf(tl.id);
      if (idx >= 0) S.visibleTimelines.splice(idx, 1);
      else S.visibleTimelines.push(tl.id);
      renderChips();
      renderView();
    });
    // Delete timeline
    chip.querySelector('.chip-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (tl.is_merged) {
        // Unmerge
        await apiFetch('/api/unmerge', { method: 'POST', body: JSON.stringify({ timeline_id: tl.id }) });
      } else {
        await apiFetch(`/api/timelines/${tl.id}`, { method: 'DELETE' });
      }
      S.timelines = S.timelines.filter(t => t.id !== tl.id);
      S.visibleTimelines = S.visibleTimelines.filter(id => id !== tl.id);
      S.selectedTimelines.delete(tl.id);
      renderChips();
      renderView();
    });
    chipScroll.appendChild(chip);
  });
  updateMergeBtn();
}

function updateMergeBtn() {
  const sel = [...S.selectedTimelines];
  const hasMerged = sel.some(id => S.timelines.find(t => t.id === id)?.is_merged);
  if (sel.length === 1 && hasMerged) {
    btnMerge.textContent = 'Unmerge';
    btnMerge.disabled = false;
  } else if (sel.length >= 2 && !hasMerged) {
    btnMerge.textContent = 'Merge';
    btnMerge.disabled = false;
  } else {
    btnMerge.textContent = 'Merge';
    btnMerge.disabled = true;
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
