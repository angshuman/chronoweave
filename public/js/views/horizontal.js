/* ChronoWeave -- Horizontal (Proportional) View */

import { S } from '../state.js';
import { esc } from '../utils.js';
import { parseDate, fmtDateRange, evtColor, impScale, getYearStep } from '../helpers.js';
import { detectGaps, buildGapCroppedMapping } from '../gaps.js';
import { openModal } from '../modal.js';

export function renderHorizontalView(events, hiddenCount, allEvts, canvas) {
  if (!events.length) {
    canvas.innerHTML = '<div class="empty-note">No events to display</div>';
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "horiz-view";

  const parsed = events.map(e => ({
    ...e,
    _start: parseDate(e.start_date),
    _end: e.end_date ? parseDate(e.end_date) : null,
  })).filter(e => e._start);

  if (!parsed.length) {
    canvas.innerHTML = '<div class="empty-note">No valid dates found</div>';
    return;
  }

  parsed.sort((a, b) => a._start - b._start);

  const minTs = Math.min(...parsed.map(e => e._start));
  const maxTs = Math.max(...parsed.map(e => e._end || e._start));
  const span = maxTs - minTs || 1;

  const PAD_LEFT = 60;
  const PAD_RIGHT = 60;

  // Much tighter: reduce px-per-year significantly
  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);
  const basePxYear = totalYearsRaw > 100 ? 20 : totalYearsRaw > 50 ? 30 : totalYearsRaw > 20 ? 40 : totalYearsRaw > 10 ? 55 : 70;
  const PX_PER_YEAR_H = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR_H / (365.25 * 24 * 3600 * 1000);

  const CONN_LEN_V = 30;
  const LABEL_H = 52; // enough for 2-line title + date

  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, PAD_LEFT);

  const contentWidth = mapping.totalPx || 800;
  const totalWidth = PAD_LEFT + contentWidth + PAD_RIGHT;

  function xPos(ts) { return mapping.posFunc(ts); }

  const maxAboveLanes = 3;
  const halfHeight = maxAboveLanes * (LABEL_H + CONN_LEN_V) + 60;
  const totalH = halfHeight * 2;
  const axisY = halfHeight;

  wrap.style.height = totalH + "px";
  wrap.style.minWidth = totalWidth + "px";

  // Axis
  const axisEl = document.createElement("div");
  axisEl.className = "horiz-axis";
  axisEl.style.top = axisY + "px";
  axisEl.style.transform = "none";
  wrap.appendChild(axisEl);

  // Year labels
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  const majorStart = Math.floor(minYear / yearStep) * yearStep;
  for (let y = majorStart; y <= maxYear + yearStep; y += yearStep) {
    if (y < minYear || y > maxYear) continue;
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const x = xPos(ts);
    const lbl = document.createElement("div");
    lbl.className = "horiz-year-label";
    lbl.style.left = x + "px";
    lbl.style.top = axisY + "px";
    lbl.style.transform = "translate(-50%, 12px)";
    lbl.textContent = y;
    wrap.appendChild(lbl);
    const tick = document.createElement("div");
    tick.className = "horiz-year-tick";
    tick.style.left = x + "px";
    tick.style.top = (axisY - 8) + "px";
    tick.style.transform = "none";
    wrap.appendChild(tick);
  }

  // Gap breaks -- zig-zag break indicator on axis
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break-hz";
    br.style.left = (gb.pos - 32) + "px";
    br.style.top = (axisY - 28) + "px";
    br.innerHTML = `
      <div class="gap-break-zone-h"></div>
      <svg class="gap-break-zigzag-h" viewBox="0 0 64 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 28 L16 18 L28 38 L40 18 L52 38 L60 28" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="gap-break-pill-h">${gb.label}</span>
    `;
    wrap.appendChild(br);
  });

  // Build items
  const items = parsed.map((e, idx) => {
    const x = xPos(e._start);
    const imp = e.importance || 5;
    return { evt: e, x, imp, idx, side: (idx % 2 === 0) ? "above" : "below", lane: 0 };
  });

  // De-overlap: for items on same side, push to higher lanes if too close
  const LABEL_W = 140;
  const MIN_X_GAP = LABEL_W + 10;
  const aboveItems = items.filter(it => it.side === "above").sort((a, b) => a.x - b.x);
  const belowItems = items.filter(it => it.side === "below").sort((a, b) => a.x - b.x);

  function dxDeOverlap(arr) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].x - arr[i - 1].x < MIN_X_GAP) {
        arr[i].lane = arr[i - 1].lane + 1;
      } else {
        arr[i].lane = 0; // reset lane if enough space
      }
    }
  }
  dxDeOverlap(aboveItems);
  dxDeOverlap(belowItems);

  // Render
  items.forEach((item, i) => {
    const { evt, x, imp, side, lane } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);

    const node = document.createElement("div");
    node.className = "horiz-node";
    node.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

    // Dot on axis
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = x + "px";
    dot.style.top = axisY + "px";
    node.appendChild(dot);

    // Vertical connector
    const connLen = CONN_LEN_V + lane * (LABEL_H + 4);
    const vconn = document.createElement("div");
    vconn.className = "horiz-vconn";
    vconn.style.background = col;
    vconn.style.left = x + "px";
    if (side === "above") {
      vconn.style.top = (axisY - connLen) + "px";
      vconn.style.height = connLen + "px";
    } else {
      vconn.style.top = axisY + "px";
      vconn.style.height = connLen + "px";
    }
    node.appendChild(vconn);

    // Text label -- allow wrapping, no truncation
    const label = document.createElement("div");
    label.className = "horiz-label";
    label.style.left = x + "px";
    label.style.transform = "translateX(-50%)";
    label.style.opacity = sc.opacity;
    if (side === "above") {
      label.style.top = (axisY - connLen - LABEL_H) + "px";
    } else {
      label.style.top = (axisY + connLen + 4) + "px";
    }
    label.innerHTML = `
      <div class="htl-title" style="font-size:${Math.max(sc.titleSize - 2, 10)}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
      <div class="htl-date">${fmtDateRange(evt)}</div>
    `;
    node.appendChild(label);

    node.addEventListener("click", () => openModal(evt));
    wrap.appendChild(node);
  });

  canvas.appendChild(wrap);
}
