/* ChronoWeave -- Account UI (login button, user menu, credits, pricing modal) */

import { getUser, isLoggedIn, triggerGoogleLogin, logout, authFetch } from './auth.js';
import { S } from './state.js';

let _sidebarBottom = null;
let _topbarActions = null;

// -- Init: inject UI into sidebar & topbar ---------------------------------

export function initAccountUI() {
  _sidebarBottom = document.querySelector(".sidebar-bottom");
  _topbarActions = document.querySelector(".topbar-actions");

  // Add credit display to topbar (before existing actions)
  const creditEl = document.createElement("div");
  creditEl.className = "credit-display hidden";
  creditEl.id = "creditDisplay";
  creditEl.innerHTML = `<i data-lucide="coins" style="width:14px;height:14px"></i><span id="creditCount">0</span>`;
  creditEl.addEventListener("click", showPricingModal);
  _topbarActions.prepend(creditEl);

  // Add publish & export buttons to topbar
  const pubBtn = document.createElement("button");
  pubBtn.className = "btn-action hidden";
  pubBtn.id = "publishBtn";
  pubBtn.innerHTML = `<i data-lucide="globe" style="width:14px;height:14px"></i> Publish`;
  pubBtn.addEventListener("click", handlePublish);

  const expBtn = document.createElement("button");
  expBtn.className = "btn-action hidden";
  expBtn.id = "exportBtn";
  expBtn.innerHTML = `<i data-lucide="download" style="width:14px;height:14px"></i> Export`;
  expBtn.addEventListener("click", handleExport);

  _topbarActions.appendChild(pubBtn);
  _topbarActions.appendChild(expBtn);

  // Add auth section to sidebar bottom (before theme picker)
  const authSection = document.createElement("div");
  authSection.className = "auth-section";
  authSection.id = "authSection";
  _sidebarBottom.prepend(authSection);

  renderAuth();
  lucide.createIcons();
}

// -- Render auth state -----------------------------------------------------

export function renderAuth() {
  const section = document.getElementById("authSection");
  if (!section) return;

  const user = getUser();
  const creditDisplay = document.getElementById("creditDisplay");
  const publishBtn = document.getElementById("publishBtn");
  const exportBtn = document.getElementById("exportBtn");

  if (user) {
    section.innerHTML = `
      <div class="user-card">
        <img class="user-avatar" src="${user.picture || ''}" alt="" onerror="this.style.display='none'">
        <div class="user-info">
          <span class="user-name">${escHtml(user.name)}</span>
          <span class="user-credits"><i data-lucide="coins" style="width:11px;height:11px"></i> ${user.credits.toLocaleString()} credits</span>
        </div>
        <button class="user-menu-btn" id="userMenuBtn"><i data-lucide="more-vertical" style="width:14px;height:14px"></i></button>
      </div>
      <div class="user-menu hidden" id="userMenu">
        <button class="um-item" id="umBuyCredits"><i data-lucide="plus-circle" style="width:14px;height:14px"></i> Buy credits</button>
        <button class="um-item" id="umPublished"><i data-lucide="globe" style="width:14px;height:14px"></i> My published</button>
        <button class="um-item um-logout" id="umLogout"><i data-lucide="log-out" style="width:14px;height:14px"></i> Sign out</button>
      </div>
    `;
    lucide.createIcons({ nodes: [section] });

    section.querySelector("#userMenuBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      section.querySelector("#userMenu").classList.toggle("hidden");
    });
    section.querySelector("#umBuyCredits").addEventListener("click", showPricingModal);
    section.querySelector("#umPublished").addEventListener("click", showPublishedModal);
    section.querySelector("#umLogout").addEventListener("click", () => {
      logout();
      renderAuth();
    });
    document.addEventListener("click", () => {
      const menu = document.getElementById("userMenu");
      if (menu) menu.classList.add("hidden");
    }, { once: true });

    // Show credit display and action buttons
    if (creditDisplay) {
      creditDisplay.classList.remove("hidden");
      document.getElementById("creditCount").textContent = user.credits.toLocaleString();
    }
    if (publishBtn) publishBtn.classList.remove("hidden");
    if (exportBtn) exportBtn.classList.remove("hidden");
  } else {
    section.innerHTML = `
      <button class="btn-login" id="loginBtn">
        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Sign in with Google
      </button>
    `;
    section.querySelector("#loginBtn").addEventListener("click", triggerGoogleLogin);

    // Hide credit display and action buttons
    if (creditDisplay) creditDisplay.classList.add("hidden");
    if (publishBtn) publishBtn.classList.add("hidden");
    if (exportBtn) exportBtn.classList.add("hidden");
  }
}

// -- Update credit count (called after research) ---------------------------

export function updateCredits(credits) {
  const user = getUser();
  if (user) user.credits = credits;
  const el = document.getElementById("creditCount");
  if (el) el.textContent = credits.toLocaleString();
  // Also update sidebar
  const sidebar = document.querySelector(".user-credits");
  if (sidebar) sidebar.innerHTML = `<i data-lucide="coins" style="width:11px;height:11px"></i> ${credits.toLocaleString()} credits`;
  lucide.createIcons({ nodes: [sidebar?.parentElement].filter(Boolean) });
}

// -- Pricing Modal ---------------------------------------------------------

export function showPricingModal() {
  // Remove existing
  const existing = document.getElementById("pricingModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "pricing-modal-bg";
  modal.id = "pricingModal";
  modal.innerHTML = `
    <div class="pricing-modal">
      <div class="pm-header">
        <h3>Buy Credits</h3>
        <button class="icon-btn pm-close"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>
      <p class="pm-subtitle">Credits are used for timeline research and refinement</p>
      <div class="pm-tiers" id="pmTiers">
        <div class="pm-tier" data-tier="starter">
          <span class="pm-tier-name">Starter</span>
          <span class="pm-tier-credits">500 credits</span>
          <span class="pm-tier-price">$4.99</span>
        </div>
        <div class="pm-tier pm-popular" data-tier="standard">
          <span class="pm-badge">Most Popular</span>
          <span class="pm-tier-name">Standard</span>
          <span class="pm-tier-credits">2,000 credits</span>
          <span class="pm-tier-price">$14.99</span>
        </div>
        <div class="pm-tier" data-tier="pro">
          <span class="pm-tier-name">Pro</span>
          <span class="pm-tier-credits">5,000 credits</span>
          <span class="pm-tier-price">$29.99</span>
        </div>
      </div>
      <div class="pm-costs">
        <span>New research: 10 credits</span>
        <span>Follow-up: 5 credits</span>
        <span>Merge: 5 credits</span>
        <span>Publish & Export: Free</span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  lucide.createIcons({ nodes: [modal] });

  modal.querySelector(".pm-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll(".pm-tier").forEach(el => {
    el.addEventListener("click", async () => {
      if (!isLoggedIn()) { triggerGoogleLogin(); return; }
      const tierId = el.dataset.tier;
      el.innerHTML = '<span class="pm-loading">Redirecting to checkout...</span>';
      try {
        const result = await authFetch("/api/stripe/checkout", {
          method: "POST",
          body: JSON.stringify({ tier_id: tierId }),
        });
        if (result.url) window.location.href = result.url;
      } catch (err) {
        el.innerHTML = `<span class="pm-error">${err.message}</span>`;
      }
    });
  });
}

// -- Publish ---------------------------------------------------------------

async function handlePublish() {
  if (!isLoggedIn()) { triggerGoogleLogin(); return; }
  if (!S.activeId) return;

  const publishBtn = document.getElementById("publishBtn");
  const origHTML = publishBtn.innerHTML;
  publishBtn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px" class="spin"></i> Publishing...';
  publishBtn.disabled = true;

  try {
    const result = await authFetch("/api/publish", {
      method: "POST",
      body: JSON.stringify({ session_id: S.activeId }),
    });
    showToast(`Published! Share link: ${window.location.origin}/p/${result.slug}`);
    // Copy link to clipboard
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${result.slug}`);
      showToast("Link copied to clipboard");
    } catch {}
  } catch (err) {
    showToast(`Publish failed: ${err.message}`, true);
  } finally {
    publishBtn.innerHTML = origHTML;
    publishBtn.disabled = false;
    lucide.createIcons({ nodes: [publishBtn] });
  }
}

// -- Export ----------------------------------------------------------------

async function handleExport() {
  if (!S.activeId) return;
  try {
    const yaml = await authFetch(`/api/export/${S.activeId}`);
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chronoweave-${S.activeId}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Timeline exported as YAML");
  } catch (err) {
    showToast(`Export failed: ${err.message}`, true);
  }
}

// -- Published list modal --------------------------------------------------

async function showPublishedModal() {
  const existing = document.getElementById("publishedModal");
  if (existing) existing.remove();

  let items = [];
  try { items = await authFetch("/api/published"); } catch {}

  const modal = document.createElement("div");
  modal.className = "pricing-modal-bg";
  modal.id = "publishedModal";

  const itemsHtml = items.length
    ? items.map(p => `
      <div class="pub-item">
        <a href="/p/${p.slug}" target="_blank" class="pub-title">${escHtml(p.title)}</a>
        <span class="pub-date">${new Date(p.updated_at).toLocaleDateString()}</span>
        <button class="pub-del" data-id="${p.id}"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
      </div>
    `).join("")
    : '<div class="empty-note">No published timelines yet</div>';

  modal.innerHTML = `
    <div class="pricing-modal" style="max-width:500px">
      <div class="pm-header">
        <h3>My Published Timelines</h3>
        <button class="icon-btn pm-close"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>
      <div class="pub-list">${itemsHtml}</div>
    </div>
  `;
  document.body.appendChild(modal);
  lucide.createIcons({ nodes: [modal] });

  modal.querySelector(".pm-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll(".pub-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await authFetch(`/api/published/${btn.dataset.id}`, { method: "DELETE" });
        btn.closest(".pub-item").remove();
      } catch {}
    });
  });
}

// -- Toast -----------------------------------------------------------------

function showToast(msg, isError = false) {
  const existing = document.querySelector(".cw-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `cw-toast${isError ? " cw-toast-error" : ""}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("cw-toast-show"), 10);
  setTimeout(() => {
    toast.classList.remove("cw-toast-show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escHtml(s) {
  const el = document.createElement("span");
  el.textContent = s || "";
  return el.innerHTML;
}
