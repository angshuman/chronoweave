/* ChronoWeave -- Vertical (Linear Proportional) View */

import { S } from '../state.js';
import { canvasWrap } from '../dom.js';
import { esc } from '../utils.js';
import { parseDate, fmtDateRange, evtColor, impScale, getYearStep } from '../helpers.js';
import { detectGaps, buildGapCroppedMapping } from '../gaps.js';
import { openModal } from '../modal.js';

export function renderLinearView(events, hiddenCount, allEvts, canvas) {
  if (!events.length) {
    canvas.innerHTML = '<div class="empty-note">No events to display</div>';
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "linear-view";

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

  const containerW = canvasWrap.clientWidth - 40;
  // Axis at 35% to leave more room for right-side text
  const AXIS_X = Math.round(containerW * 0.28);
  const CONN_LEN = 20;
  const TEXT_GAP = 6;
  const RIGHT_W = Math.min(containerW - AXIS_X - CONN_LEN - TEXT_GAP - 16, 480);
  const LEFT_W = Math.min(AXIS_X - CONN_LEN - TEXT_GAP - 16, 200);

  // Event card height estimate for de-overlap
  const CARD_H = 56;
  const MIN_Y_GAP = CARD_H + 6;

  // Compact px-per-year: much tighter than before
  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);
  const basePxYear = totalYearsRaw > 100 ? 8 : totalYearsRaw > 50 ? 12 : totalYearsRaw > 20 ? 18 : totalYearsRaw > 10 ? 22 : 30;
  const PX_PER_YEAR = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR / (365.25 * 24 * 3600 * 1000);

  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, 30);

  function yPos(ts) { return mapping.posFunc(ts); }

  // Collect gap break zones for collision avoidance
  // Gap break is 64px tall (centered), pill adds ~24px below, plus margin
  const GAP_CLEARANCE = 58; // pixels above and below gap center to keep clear
  const gapZones = mapping.gapBreaks.map(gb => ({
    center: gb.pos,
    top: gb.pos - GAP_CLEARANCE,
    bottom: gb.pos + GAP_CLEARANCE,
  }));

  // Axis
  const axis = document.createElement("div");
  axis.className = "linear-axis";
  axis.style.left = AXIS_X + "px";
  wrap.appendChild(axis);

  // Build items with y positions FIRST (needed for year label collision check)
  const items = parsed.map((e, i) => {
    const y = yPos(e._start);
    const yEnd = e._end ? yPos(e._end) : y;
    const imp = e.importance || 5;
    return { evt: e, y, yEnd, imp, idx: i, side: 0, adjustedY: y };
  });

  items.sort((a, b) => a.y - b.y);

  // All events on right side (no alternating -- keeps year labels on left clear)
  items.forEach((item) => {
    item.side = 1;
  });

  // De-overlap: push events down if they are too close OR in a gap zone
  for (let i = 0; i < items.length; i++) {
    // Check gap zone collision
    for (const gz of gapZones) {
      if (items[i].adjustedY >= gz.top && items[i].adjustedY <= gz.bottom) {
        items[i].adjustedY = gz.bottom + 4;
      }
    }
    // Check event-to-event overlap
    if (i > 0 && items[i].adjustedY - items[i - 1].adjustedY < MIN_Y_GAP) {
      items[i].adjustedY = items[i - 1].adjustedY + MIN_Y_GAP;
    }
  }

  // Year labels -- placed on the LEFT side of axis, prominent style.
  // Use adjusted (de-overlapped) event positions so labels align with
  // where events actually render, not their raw temporal positions.
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  const majorStart = Math.floor(minYear / yearStep) * yearStep;

  // Build a lookup: for each year boundary, find the adjusted Y position
  // by interpolating between surrounding events.
  function adjustedYForTs(ts) {
    // Find the two items whose raw timestamps bracket this ts
    // Items are sorted by raw y (which monotonically maps to _start)
    if (!items.length) return yPos(ts);
    // Before first event
    if (ts <= items[0].evt._start) return items[0].adjustedY;
    // After last event
    if (ts >= items[items.length - 1].evt._start) return items[items.length - 1].adjustedY;
    // Between events: find bracketing pair and interpolate
    for (let i = 0; i < items.length - 1; i++) {
      const tsA = items[i].evt._start;
      const tsB = items[i + 1].evt._start;
      if (ts >= tsA && ts <= tsB) {
        const frac = (tsB === tsA) ? 0 : (ts - tsA) / (tsB - tsA);
        return items[i].adjustedY + frac * (items[i + 1].adjustedY - items[i].adjustedY);
      }
    }
    return items[items.length - 1].adjustedY;
  }

  // Minimum spacing between year labels to avoid overlap
  const YEAR_LABEL_MIN_GAP = 28;
  let lastYearLabelTop = -Infinity;

  for (let y = majorStart; y <= maxYear + yearStep; y += yearStep) {
    if (y < minYear || y > maxYear) continue;
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;

    const top = adjustedYForTs(ts);

    // Check if this label would collide with a gap zone
    let skipLabel = false;
    for (const gz of gapZones) {
      if (Math.abs(top - gz.center) < GAP_CLEARANCE) {
        skipLabel = true;
        break;
      }
    }
    if (skipLabel) continue;

    // Skip if too close to the previous year label
    if (top - lastYearLabelTop < YEAR_LABEL_MIN_GAP) continue;
    lastYearLabelTop = top;

    // Major: decade/century boundaries, first visible year, or large step sizes
    const isFirstLabel = (wrap.querySelectorAll('.linear-year-label').length === 0);
    const isMajor = y % 10 === 0 || isFirstLabel || yearStep >= 5;

    const lbl = document.createElement("div");
    lbl.className = "linear-year-label" + (isMajor ? " major" : "");
    lbl.style.top = top + "px";
    lbl.style.left = (AXIS_X - 56) + "px";
    lbl.style.width = "48px";
    lbl.textContent = y;
    wrap.appendChild(lbl);

    const tick = document.createElement("div");
    tick.className = "linear-year-tick" + (isMajor ? " major" : "");
    tick.style.top = top + "px";
    tick.style.left = (AXIS_X - 6) + "px";
    wrap.appendChild(tick);

    // Add a faint horizontal guide line across the full width for major years
    if (isMajor) {
      const guide = document.createElement("div");
      guide.className = "linear-year-guide";
      guide.style.top = top + "px";
      guide.style.left = (AXIS_X + 2) + "px";
      guide.style.right = "0";
      wrap.appendChild(guide);
    }
  }

  // Gap breaks -- zig-zag break indicator across axis
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break-v";
    br.style.top = (gb.pos - 32) + "px";
    br.style.left = (AXIS_X - 20) + "px";
    br.innerHTML = `
      <div class="gap-break-zone"></div>
      <svg class="gap-break-zigzag" viewBox="0 0 40 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 4 L12 16 L28 28 L12 40 L28 52 L20 60" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="gap-break-pill">${gb.label}</span>
    `;
    wrap.appendChild(br);
  });

  // Render nodes
  items.forEach((item, i) => {
    const { evt, y, yEnd, imp, side, adjustedY } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);
    const isDuration = evt._end && evt._end !== evt._start;
    const textW = RIGHT_W;

    const node = document.createElement("div");
    node.className = "tl-node";
    node.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

    // Dot on axis — placed at adjustedY to stay aligned with the text card
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = AXIS_X + "px";
    dot.style.top = adjustedY + "px";
    node.appendChild(dot);

    // Duration range bar — stays at the true temporal position
    if (isDuration && yEnd > y) {
      const range = document.createElement("div");
      range.className = "tl-range";
      range.style.background = col;
      range.style.top = y + "px";
      range.style.left = (AXIS_X - 1) + "px";
      range.style.height = Math.max(yEnd - y, 4) + "px";
      node.appendChild(range);
    }

    // Connector line from dot to text
    const conn = document.createElement("div");
    conn.className = "tl-conn";
    conn.style.background = col;
    conn.style.left = (AXIS_X + 2) + "px";
    conn.style.width = CONN_LEN + "px";
    conn.style.top = adjustedY + "px";
    node.appendChild(conn);

    // Text label
    const text = document.createElement("div");
    text.className = "tl-text";
    text.style.top = adjustedY + "px";
    text.style.transform = "translateY(-50%)";
    text.style.opacity = sc.opacity;
    text.style.width = Math.max(textW, 120) + "px";
    text.style.maxWidth = Math.max(textW, 120) + "px";
    text.style.left = (AXIS_X + CONN_LEN + TEXT_GAP) + "px";

    const dateStr = fmtDateRange(evt);
    text.innerHTML = `
      <div class="tl-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
      <div class="tl-sub"><span class="tl-date-inline">${dateStr}</span> ${esc(evt.description || "")}</div>
    `;
    node.appendChild(text);

    node.addEventListener("click", () => openModal(evt));
    wrap.appendChild(node);
  });

  const maxBottom = items.length ? Math.max(...items.map(it => it.adjustedY + CARD_H), ...items.map(it => it.yEnd + 20)) : 400;
  wrap.style.height = Math.max(400, maxBottom + 60) + "px";
  wrap.style.minWidth = (AXIS_X + CONN_LEN + 200) + "px";

  canvas.appendChild(wrap);
}
