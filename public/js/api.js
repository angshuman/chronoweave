/* ChronoWeave -- API & Loader Helpers */

import { API } from './state.js';

export async function apiFetch(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || r.statusText);
  }
  return r.json();
}

export function showLoader(msg = 'Loading...') {
  const el = document.getElementById('researchLoader');
  const sub = document.getElementById('loaderSub');
  if (el) el.classList.remove('hidden');
  if (sub) sub.textContent = msg;
}

export function hideLoader() {
  const el = document.getElementById('researchLoader');
  if (el) el.classList.add('hidden');
}

export function loadPref(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; }
  catch { return def; }
}
export function savePref(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
