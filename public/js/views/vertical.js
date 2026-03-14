/* ChronoWeave — Vertical (Linear Proportional) View */

import { S, GAP_BREAK_SVG } from '../state.js';
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
  const AXIS_X = Math.round(containerW * 0.42);
  const CONN_LEN = 28;
  const TEXT_GAP = 6;
  const RIGHT_W = Math.min(containerW - AXIS_X - CONN_LEN - TEXT_GAP - 16, 440);
  const LEFT_W = Math.min(AXIS_X - CONN_LEN - TEXT_GAP - 16, 440);
  const MIN_Y_GAP = 44;

  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);
  const basePxYear = totalYearsRaw > 30 ? 25 : totalYearsRaw > 10 ? 40 : 55;
  const PX_PER_YEAR = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR / (365.25 * 24 * 3600 * 1000);

  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, 30);

  function yPos(ts) { return mapping.posFunc(ts); }

  // Axis
  const axis = document.createElement("div");
  axis.className = "linear-axis";
  axis.style.left = AXIS_X + "px";
  wrap.appendChild(axis);

  // Year labels
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  const majorStart = Math.floor(minYear / yearStep) * yearStep;
  const minorStep = Math.max(1, Math.floor(yearStep / 2));
  const majorYearSet = new Set();
  for (let y = majorStart; y <= maxYear + yearStep; y += yearStep) majorYearSet.add(y);

  for (let y = majorStart; y <= maxYear + yearStep; y += (minorStep < yearStep ? minorStep : 1)) {
    if (y < minYear || y > maxYear) continue;
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const top = yPos(ts);
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const isMajor = majorYearSet.has(y);
    if (isMajor) {
      const lbl = document.createElement("div");
      lbl.className = "linear-year-label";
      lbl.style.top = top + "px";
      lbl.style.left = (AXIS_X - 52) + "px";
      lbl.style.width = "44px";
      lbl.textContent = y;
      wrap.appendChild(lbl);
      const tick = document.createElement("div");
      tick.className = "linear-year-tick";
      tick.style.top = top + "px";
      tick.style.left = (AXIS_X - 6) + "px";
      wrap.appendChild(tick);
    } else if (minorStep < yearStep) {
      const tick = document.createElement("div");
      tick.className = "linear-year-tick-minor";
      tick.style.top = top + "px";
      tick.style.left = (AXIS_X - 3) + "px";
      wrap.appendChild(tick);
    }
    if (minorStep >= yearStep) y += yearStep - 1;
  }

  // Gap breaks
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break";
    br.style.top = gb.pos + "px";
    br.style.left = (AXIS_X - 6) + "px";
    br.innerHTML = `<div class="gap-break-line">${GAP_BREAK_SVG}${GAP_BREAK_SVG}</div><span class="gap-break-label">${gb.label}</span>`;
    wrap.appendChild(br);
  });

  // Build items with y positions
  const items = parsed.map((e, i) => {
    const y = yPos(e._start);
    const yEnd = e._end ? yPos(e._end) : y;
    const imp = e.importance || 5;
    return { evt: e, y, yEnd, imp, idx: i, side: 0, adjustedY: y };
  });

  items.sort((a, b) => a.y - b.y);

  // Assign sides: alternate
  items.forEach((item, i) => {
    item.side = (i % 2 === 0) ? 1 : -1;
  });

  // De-overlap per side independently
  const rightItems = items.filter(it => it.side === 1).sort((a, b) => a.y - b.y);
  const leftItems = items.filter(it => it.side === -1).sort((a, b) => a.y - b.y);

  function deOverlapSide(arr) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].adjustedY - arr[i - 1].adjustedY < MIN_Y_GAP) {
        arr[i].adjustedY = arr[i - 1].adjustedY + MIN_Y_GAP;
      }
    }
  }
  deOverlapSide(rightItems);
  deOverlapSide(leftItems);

  // Render nodes
  items.forEach((item, i) => {
    const { evt, y, yEnd, imp, side, adjustedY } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);
    const isDuration = evt._end && evt._end !== evt._start;
    const textW = side > 0 ? RIGHT_W : LEFT_W;

    const node = document.createElement("div");
    node.className = "tl-node";
    node.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

    // Dot on axis
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = AXIS_X + "px";
    dot.style.top = y + "px";
    node.appendChild(dot);

    // Duration range bar
    if (isDuration && yEnd > y) {
      const range = document.createElement("div");
      range.className = "tl-range";
      range.style.background = col;
      range.style.top = y + "px";
      range.style.left = (AXIS_X - 1) + "px";
      range.style.height = Math.max(yEnd - y, 4) + "px";
      node.appendChild(range);
    }

    // Connector line
    const conn = document.createElement("div");
    conn.className = "tl-conn";
    conn.style.background = col;
    const connTop = adjustedY;
    if (side > 0) {
      conn.style.left = (AXIS_X + 2) + "px";
      conn.style.width = CONN_LEN + "px";
    } else {
      conn.style.left = (AXIS_X - CONN_LEN - 2) + "px";
      conn.style.width = CONN_LEN + "px";
    }
    conn.style.top = connTop + "px";
    node.appendChild(conn);

    // Vertical joiner if label was pushed
    if (Math.abs(adjustedY - y) > 2) {
      const joiner = document.createElement("div");
      joiner.className = "tl-conn";
      joiner.style.background = col;
      joiner.style.width = "1px";
      joiner.style.height = Math.abs(adjustedY - y) + "px";
      joiner.style.top = Math.min(y, adjustedY) + "px";
      joiner.style.left = (side > 0 ? AXIS_X + 2 : AXIS_X - 2) + "px";
      node.appendChild(joiner);
    }

    // Text label
    const text = document.createElement("div");
    text.className = "tl-text";
    text.style.top = connTop + "px";
    text.style.transform = "translateY(-50%)";
    text.style.opacity = sc.opacity;
    text.style.width = Math.max(textW, 120) + "px";
    text.style.maxWidth = Math.max(textW, 120) + "px";
    if (side > 0) {
      text.style.left = (AXIS_X + CONN_LEN + TEXT_GAP) + "px";
    } else {
      const leftEdge = AXIS_X - CONN_LEN - TEXT_GAP - Math.max(textW, 120);
      text.style.left = Math.max(4, leftEdge) + "px";
      text.style.textAlign = "right";
    }

    const dateStr = fmtDateRange(evt);
    text.innerHTML = `
      <div class="tl-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
      <div class="tl-sub"><span class="tl-date-inline">${dateStr}</span> ${esc(evt.description || "")}</div>
    `;
    node.appendChild(text);

    node.addEventListener("click", () => openModal(evt));
    wrap.appendChild(node);
  });

  const maxBottom = items.length ? Math.max(...items.map(it => it.adjustedY + 40), ...items.map(it => it.yEnd + 40)) : 400;
  wrap.style.height = Math.max(400, maxBottom + 60) + "px";
  wrap.style.minWidth = (AXIS_X + CONN_LEN + 200) + "px";

  canvas.appendChild(wrap);
}
