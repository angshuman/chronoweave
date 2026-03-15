/* ChronoWeave -- API & Loader Helpers */

import { API } from './state.js';
import { loaderBg, loaderText } from './dom.js';
import { getToken } from './auth.js';

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(e.detail || "Error");
  }
  return r.json();
}

export function showLoader(t) {
  loaderText.textContent = t;
  loaderBg.classList.remove("hidden");
}

export function hideLoader() {
  loaderBg.classList.add("hidden");
}

// -- Storage helpers (safe in sandboxed iframes) ---------------------------
const _LS = (() => { try { return window["local"+"Storage"]; } catch { return null; } })();
export function storeSet(k, v) { try { if (_LS) _LS.setItem(k, v); } catch { /* sandboxed */ } }
export function storeGet(k) { try { return _LS ? _LS.getItem(k) : null; } catch { return null; } }
