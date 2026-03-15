/* ChronoWeave -- List View (with year section headers) */

import { esc } from '../utils.js';
import { evtColor, impScale, fmtDateRange, parseDate } from '../helpers.js';
import { openModal } from '../modal.js';

export function renderListView(events, hiddenCount, canvas) {
  const wrap = document.createElement("div");
  wrap.className = "list-view";

  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.cssText = "padding:8px 0;font-size:11px";
    note.textContent = `${hiddenCount} lower-importance event${hiddenCount > 1 ? "s" : ""} hidden`;
    wrap.appendChild(note);
  }

  // Group events by year for section headers
  let lastYear = null;

  events.forEach((evt, i) => {
    // Extract year from start_date
    const year = extractYear(evt.start_date);

    // Add year section header when year changes
    if (year !== null && year !== lastYear) {
      const yearHeader = document.createElement("div");
      yearHeader.className = "list-year-header";
      yearHeader.innerHTML = `
        <span class="list-year-line"></span>
        <span class="list-year-label">${year}</span>
        <span class="list-year-line"></span>
      `;
      wrap.appendChild(yearHeader);
      lastYear = year;
    }

    const el = document.createElement("div");
    el.className = "list-ev";
    el.style.animationDelay = `${Math.min(i * 25, 500)}ms`;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const sc = impScale(imp);

    el.innerHTML = `
      <div class="list-dot" style="background:${col};width:${sc.dotSize}px;height:${sc.dotSize}px"></div>
      <div class="list-label" style="opacity:${sc.opacity}">
        <div class="l-date">${fmtDateRange(evt)}</div>
        <div class="l-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
        <div class="l-desc" style="font-size:${sc.descSize}px">${esc(evt.description || "")}</div>
        ${evt.category ? `<div class="l-meta"><span class="l-cat">${esc(evt.category)}</span></div>` : ""}
      </div>
    `;
    el.addEventListener("click", () => openModal(evt));
    wrap.appendChild(el);
  });
  canvas.appendChild(wrap);
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}
