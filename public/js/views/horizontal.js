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

  const PAD_LEFT = 100;
  const PAD_RIGHT = 100;
  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);

  // Generous horizontal spacing — scale with event density
  const eventsPerYear = parsed.length / Math.max(totalYearsRaw, 1);
  const densityFactor = Math.min(3.0, Math.max(1.1, eventsPerYear * 2.5));
  const basePxYear = (totalYearsRaw > 100 ? 30 : totalYearsRaw > 50 ? 48 : totalYearsRaw > 20 ? 70 : totalYearsRaw > 10 ? 90 : 110) * densityFactor;
  const PX_PER_YEAR_H = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR_H / (365.25 * 24 * 3600 * 1000);

  const LABEL_W = 130;
  const LABEL_H_EST = 48;
  const MIN_X_GAP = 10;

  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, PAD_LEFT);

  const contentWidth = mapping.totalPx || 800;

  function xPos(ts) { return mapping.posFunc(ts); }

  // Gap break zones
  const GAP_CLEARANCE_X = 56;
  const gapZones = mapping.gapBreaks.map(gb => ({
    center: gb.pos,
    left: gb.pos - GAP_CLEARANCE_X,
    right: gb.pos + GAP_CLEARANCE_X,
  }));

  // -- Build items with raw x positions --
  const rawItems = parsed.map((e, idx) => {
    let x = xPos(e._start);
    const imp = e.importance || 5;
    for (const gz of gapZones) {
      if (x > gz.left && x < gz.right) {
        x = (x < gz.center) ? gz.left : gz.right;
      }
    }
    return { evt: e, x, imp, idx, side: null, tier: 0 };
  });

  rawItems.sort((a, b) => a.x - b.x);

  // -- HORIZONTAL SPREADING --
  // Nudge adjacent events apart so labels don't overlap.
  // Since labels strictly alternate above/below, adjacent events need
  // only half-label separation; same-side events (i, i+2) need full.
  // We enforce the adjacent minimum and the tier system handles the rest.
  // Need ~half label width between adjacent dots since they alternate sides.
  // For extreme clusters, more spreading is needed.
  const MIN_ADJACENT_GAP = LABEL_W * 0.54;
  const items = [...rawItems];
  
  // Force-directed relaxation
  for (let pass = 0; pass < 12; pass++) {
    let maxForce = 0;
    for (let i = 1; i < items.length; i++) {
      const gap = items[i].x - items[i - 1].x;
      if (gap < MIN_ADJACENT_GAP) {
        const deficit = MIN_ADJACENT_GAP - gap;
        const push = deficit * 0.5;
        items[i - 1].x -= push;
        items[i].x += push;
        maxForce = Math.max(maxForce, deficit);
      }
    }
    if (maxForce < 1) break;
  }
  // Ensure no item went negative
  const minX = Math.min(...items.map(it => it.x));
  if (minX < PAD_LEFT) {
    const shiftAll = PAD_LEFT - minX;
    items.forEach(it => it.x += shiftAll);
  }

  // Recalculate total width after spreading
  const maxX = items.length ? Math.max(...items.map(it => it.x)) : 0;
  const spreadWidth = Math.max(contentWidth, maxX + PAD_RIGHT);
  const totalWidth = spreadWidth + PAD_LEFT + LABEL_W;

  // -- STAGGER: assign side & tier --
  // Strict alternation above/below. Greedy first-fit tier assignment.
  const TIER_STEP = 54;
  const CONN_BASE = 30;
  const MAX_TIERS = 5;

  const tiersAbove = [];
  const tiersBelow = [];

  // Helper: find best tier on a given side
  function findBestTier(tiers, labelLeft) {
    for (let t = 0; t < tiers.length && t < MAX_TIERS; t++) {
      if (labelLeft >= tiers[t] + MIN_X_GAP) return t;
    }
    if (tiers.length < MAX_TIERS) return tiers.length;
    // All full — return tier with smallest right-edge
    let minEdge = Infinity, minIdx = 0;
    for (let t = 0; t < tiers.length; t++) {
      if (tiers[t] < minEdge) { minEdge = tiers[t]; minIdx = t; }
    }
    return minIdx;
  }

  items.forEach((item, i) => {
    const labelLeft = item.x - LABEL_W / 2;
    const labelRight = item.x + LABEL_W / 2;

    // Find best tier on each side
    const tierA = findBestTier(tiersAbove, labelLeft);
    const tierB = findBestTier(tiersBelow, labelLeft);

    // Prefer alternation, but pick the side with the lower tier
    const preferSide = (i % 2 === 0) ? "above" : "below";
    let side, tier;

    if (preferSide === "above") {
      if (tierA <= tierB) { side = "above"; tier = tierA; }
      else if (tierB < tierA - 1) { side = "below"; tier = tierB; }
      else { side = "above"; tier = tierA; }
    } else {
      if (tierB <= tierA) { side = "below"; tier = tierB; }
      else if (tierA < tierB - 1) { side = "above"; tier = tierA; }
      else { side = "below"; tier = tierB; }
    }

    item.side = side;
    item.tier = tier;

    const tiers = side === "above" ? tiersAbove : tiersBelow;
    while (tiers.length <= tier) tiers.push(0);
    tiers[tier] = Math.max(tiers[tier], labelRight);
  });

  // Determine max tiers
  const maxTierAbove = items.reduce((m, it) => it.side === "above" ? Math.max(m, it.tier) : m, 0);
  const maxTierBelow = items.reduce((m, it) => it.side === "below" ? Math.max(m, it.tier) : m, 0);

  // Total height
  const topSpace = CONN_BASE + (maxTierAbove + 1) * TIER_STEP + LABEL_H_EST + 16;
  const yearLabelSpace = 30;
  const botSpace = CONN_BASE + (maxTierBelow + 1) * TIER_STEP + LABEL_H_EST + 16;
  const totalH = topSpace + yearLabelSpace + botSpace;
  const axisY = topSpace;

  wrap.style.height = totalH + "px";
  wrap.style.minWidth = totalWidth + "px";

  // -- Axis line --
  const axisEl = document.createElement("div");
  axisEl.className = "horiz-axis";
  axisEl.style.top = axisY + "px";
  axisEl.style.transform = "none";
  wrap.appendChild(axisEl);

  // -- Year labels --
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
    const rawX = xPos(ts);

    let skipLabel = false;
    for (const gz of gapZones) {
      if (Math.abs(rawX - gz.center) < GAP_CLEARANCE_X) { skipLabel = true; break; }
    }
    if (skipLabel) continue;

    // Year labels use the raw mapping position (not spread)
    // but we need to offset by the average spread shift around this position
    const x = rawX;
    const isMajor = y % (yearStep * 5) === 0 || y === majorStart || yearStep >= 10;

    const lbl = document.createElement("div");
    lbl.className = "horiz-year-label" + (isMajor ? " major" : "");
    lbl.style.left = x + "px";
    lbl.style.top = (axisY + 8) + "px";
    lbl.style.transform = "translateX(-50%)";
    lbl.textContent = y;
    wrap.appendChild(lbl);

    const tick = document.createElement("div");
    tick.className = "horiz-year-tick" + (isMajor ? " major" : "");
    tick.style.left = x + "px";
    tick.style.top = (axisY - 8) + "px";
    tick.style.transform = "none";
    wrap.appendChild(tick);

    if (isMajor) {
      const guide = document.createElement("div");
      guide.className = "horiz-year-guide";
      guide.style.left = x + "px";
      guide.style.top = "0";
      guide.style.height = totalH + "px";
      wrap.appendChild(guide);
    }
  }

  // -- Gap breaks --
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

  // -- Render events --
  items.forEach((item, i) => {
    const { evt, x, imp, side, tier } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);

    const node = document.createElement("div");
    node.className = "horiz-node";
    node.style.animationDelay = `${Math.min(i * 15, 400)}ms`;

    // Dot on axis
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = x + "px";
    dot.style.top = axisY + "px";
    node.appendChild(dot);

    // Vertical connector — length based on tier
    const connLen = CONN_BASE + tier * TIER_STEP;
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

    // Text label
    const label = document.createElement("div");
    label.className = "horiz-label";
    label.style.left = x + "px";
    label.style.transform = "translateX(-50%)";
    label.style.opacity = sc.opacity;
    if (side === "above") {
      label.style.top = (axisY - connLen - LABEL_H_EST - 2) + "px";
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
