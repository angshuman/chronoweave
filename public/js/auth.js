/* ChronoWeave -- Auth Module (Google Identity Services) */

import { API } from './state.js';

let _user = null;
let _token = null;
let _onAuthChange = null;
let _googleClientId = null;

export function getUser() { return _user; }
export function getToken() { return _token; }
export function isLoggedIn() { return !!_user; }

export function setOnAuthChange(fn) { _onAuthChange = fn; }

function _notify() {
  if (_onAuthChange) _onAuthChange(_user);
}

// -- Token storage ---------------------------------------------------------

function saveToken(token) {
  _token = token;
  try { localStorage.setItem("cw_token", token); } catch {}
}

function loadToken() {
  try { return localStorage.getItem("cw_token"); } catch { return null; }
}

function clearToken() {
  _token = null;
  try { localStorage.removeItem("cw_token"); } catch {}
}

// -- API helper with auth --------------------------------------------------

export async function authFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    if (r.status === 401) {
      // Token expired — log out
      clearToken();
      _user = null;
      _notify();
    }
    throw Object.assign(new Error(e.detail || "Error"), { status: r.status, code: e.code });
  }
  // Handle text responses (YAML export)
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("text/yaml")) return r.text();
  return r.json();
}

// -- Initialize auth -------------------------------------------------------

export async function initAuth() {
  // Fetch Google Client ID from server
  try {
    const config = await fetch(`${API}/api/auth/config`).then(r => r.json());
    _googleClientId = config.google_client_id;
  } catch {
    console.warn("Could not fetch auth config");
  }

  // Try restoring session from saved token
  const saved = loadToken();
  if (saved) {
    _token = saved;
    try {
      const resp = await authFetch("/api/auth/me");
      if (resp.user) {
        _user = resp.user;
        _notify();
      } else {
        clearToken();
      }
    } catch {
      clearToken();
    }
  }

  // Load Google Identity Services if we have a client ID
  if (_googleClientId) {
    loadGSI();
  }
}

// -- Google Sign-In --------------------------------------------------------

function loadGSI() {
  if (document.getElementById("gsi-script")) return;
  const script = document.createElement("script");
  script.id = "gsi-script";
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.defer = true;
  script.onload = () => initGSI();
  document.head.appendChild(script);
}

function initGSI() {
  if (!window.google || !_googleClientId) return;
  window.google.accounts.id.initialize({
    client_id: _googleClientId,
    callback: handleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
}

async function handleCredentialResponse(response) {
  try {
    const result = await fetch(`${API}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: response.credential }),
    }).then(r => r.json());

    if (result.token && result.user) {
      saveToken(result.token);
      _user = result.user;
      _notify();
    }
  } catch (err) {
    console.error("Login failed:", err);
  }
}

export function triggerGoogleLogin() {
  if (!window.google || !_googleClientId) {
    alert("Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in your environment.");
    return;
  }
  window.google.accounts.id.prompt((notification) => {
    // If One Tap is dismissed, fall back to the button flow
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      // Use popup mode
      const client = window.google.accounts.oauth2.initCodeClient({
        client_id: _googleClientId,
        scope: "email profile",
        ux_mode: "popup",
        callback: () => {},
      });
      // Actually use the renderButton approach for reliability
      showLoginPopup();
    }
  });
}

function showLoginPopup() {
  // Create a temporary container for the Google Sign-In button
  const overlay = document.createElement("div");
  overlay.className = "gsi-overlay";
  overlay.innerHTML = `
    <div class="gsi-popup">
      <h3>Sign in to ChronoWeave</h3>
      <p>Use your Google account to get 1,000 free research credits</p>
      <div id="gsi-btn-container"></div>
      <button class="gsi-close">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".gsi-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  window.google.accounts.id.renderButton(
    document.getElementById("gsi-btn-container"),
    {
      theme: "outline",
      size: "large",
      width: 300,
      text: "signin_with",
      shape: "rectangular",
    }
  );

  // Auto-close after successful login
  const check = setInterval(() => {
    if (_user) { clearInterval(check); overlay.remove(); }
  }, 500);
  setTimeout(() => clearInterval(check), 60000);
}

// -- Logout ----------------------------------------------------------------

export function logout() {
  clearToken();
  _user = null;
  if (window.google) {
    try { window.google.accounts.id.disableAutoSelect(); } catch {}
  }
  _notify();
}
