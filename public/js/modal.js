/* ChronoWeave -- Modal */

import { _$, modalBg } from './dom.js';
import { esc } from './utils.js';
import { fmtDateRange } from './helpers.js';

export function openModal(evt) {
  _$("#mTitle").textContent = evt.title;
  _$("#mDates").textContent = fmtDateRange(evt);
  _$("#mDesc").textContent = evt.description || "";

  // Importance pips
  const impPips = _$("#mImpPips");
  impPips.innerHTML = "";
  const imp = evt.importance || 5;
  for (let p = 1; p <= 10; p++) {
    const pip = document.createElement("span");
    pip.className = "m-imp-pip" + (p <= imp ? " filled" : "");
    impPips.appendChild(pip);
  }

  const srcEl = _$("#mSources");
  srcEl.innerHTML = "";
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color || "[]");
      srcs.forEach((s, i) => {
        const it = document.createElement("span");
        it.className = "m-src-item";
        it.innerHTML = `<span class="m-src-dot" style="background:${cols[i]?.color || cols[i] || "#6e7bf2"}"></span>${esc(s.name || s)}`;
        srcEl.appendChild(it);
      });
    } catch { /* ignore */ }
  } else if (evt._tl.is_merged && evt.source_timeline_name) {
    const it = document.createElement("span");
    it.className = "m-src-item";
    it.innerHTML = `<span class="m-src-dot" style="background:${evt.source_color || "#6e7bf2"}"></span>${esc(evt.source_timeline_name)}`;
    srcEl.appendChild(it);
  }

  const tagEl = _$("#mTags");
  tagEl.innerHTML = "";
  try {
    JSON.parse(evt.tags || "[]").forEach(t => {
      const sp = document.createElement("span");
      sp.className = "m-tag";
      sp.textContent = t;
      tagEl.appendChild(sp);
    });
  } catch { /* ignore */ }

  modalBg.classList.remove("hidden");
}
