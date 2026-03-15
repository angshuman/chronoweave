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

  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);
  // Scale px/year based on event density — more events need more room
  const densityFactor = Math.min(1.3, Math.max(1, parsed.length / 15));
  const basePxYear = (totalYearsRaw > 100 ? 20 : totalYearsRaw > 50 ? 30 : totalYearsRaw > 20 ? 40 : totalYearsRaw > 10 ? 55 : 70) * densityFactor;
  const PX_PER_YEAR_H = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR_H / (365.25 * 24 * 3600 * 1000);

  const LABEL_W = 140;
  const LABEL_H = 56;
  const CONN_BASE = 28;    // minimum connector length
  const LANE_STEP = 62;    // vertical distance between lanes

  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, PAD_LEFT);

  const contentWidth = mapping.totalPx || 800;
  const totalWidth = PAD_LEFT + contentWidth + PAD_RIGHT;

  function xPos(ts) { return mapping.posFunc(ts); }

  // Gap break zones for collision avoidance
  const GAP_CLEARANCE_X = 56;
  const gapZones = mapping.gapBreaks.map(gb => ({
    center: gb.pos,
    left: gb.pos - GAP_CLEARANCE_X,
    right: gb.pos + GAP_CLEARANCE_X,
  }));

  // -- Build items with positions --
  const items = parsed.map((e, idx) => {
    let x = xPos(e._start);
    const imp = e.importance || 5;
    // Nudge events out of gap zones
    for (const gz of gapZones) {
      if (x > gz.left && x < gz.right) {
        x = (x < gz.center) ? gz.left : gz.right;
      }
    }
    return { evt: e, x, imp, idx, side: null, lane: 0 };
  });

  // -- Stagger: assign side & lane using free-lane approach --
  // Split into above and below, distributing to keep visual balance.
  // Use a greedy "first lane that's free" approach so lanes get reused,
  // creating a smooth wave rather than a climbing staircase.

  const MIN_X_CLEAR = LABEL_W + 16; // horizontal clearance between labels on same lane

  // Track occupied x-ranges per lane: { above: [[endX, ...], ...], below: [[endX, ...], ...] }
  const lanesAbove = []; // each lane is an array of "rightEdge" x-values
  const lanesBelow = [];

  // Sort by x position for greedy assignment
  const sorted = [...items].sort((a, b) => a.x - b.x);

  // Alternate starting side, but allow the algorithm to pick the shorter lane
  sorted.forEach((item, i) => {
    const preferAbove = (i % 2 === 0);

    const laneA = findFreeLaneH(lanesAbove, item.x, MIN_X_CLEAR);
    const laneB = findFreeLaneH(lanesBelow, item.x, MIN_X_CLEAR);

    // Pick the side with the lower available lane to keep things balanced
    // But give slight preference to the alternating side
    let chosenSide, chosenLane;

    if (preferAbove) {
      if (laneA <= laneB) {
        chosenSide = "above"; chosenLane = laneA;
      } else if (laneB < laneA - 1) {
        chosenSide = "below"; chosenLane = laneB;
      } else {
        chosenSide = "above"; chosenLane = laneA;
      }
    } else {
      if (laneB <= laneA) {
        chosenSide = "below"; chosenLane = laneB;
      } else if (laneA < laneB - 1) {
        chosenSide = "above"; chosenLane = laneA;
      } else {
        chosenSide = "below"; chosenLane = laneB;
      }
    }

    item.side = chosenSide;
    item.lane = chosenLane;

    // Mark lane as occupied up to rightEdge
    const lanes = chosenSide === "above" ? lanesAbove : lanesBelow;
    while (lanes.length <= chosenLane) lanes.push([]);
    lanes[chosenLane].push(item.x + MIN_X_CLEAR);
  });

  /**
   * Find the first lane where the item at xPos won't overlap.
   * A lane is "free" if all previous items on it have rightEdge <= xPos.
   */
  function findFreeLaneH(lanes, xPos, minClear) {
    for (let l = 0; l < lanes.length; l++) {
      const rightEdges = lanes[l];
      // Check if ALL entries on this lane are clear
      const isFree = rightEdges.every(re => xPos >= re);
      if (isFree) return l;
    }
    return lanes.length; // new lane needed
  }

  // Determine max lanes used
  const maxLaneAbove = items.reduce((m, it) => it.side === "above" ? Math.max(m, it.lane) : m, 0);
  const maxLaneBelow = items.reduce((m, it) => it.side === "below" ? Math.max(m, it.lane) : m, 0);
  const maxLanes = Math.max(maxLaneAbove, maxLaneBelow) + 1;

  const halfHeight = maxLanes * LANE_STEP + CONN_BASE + 40;
  const totalH = halfHeight * 2;
  const axisY = halfHeight;

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
    const x = xPos(ts);

    let skipLabel = false;
    for (const gz of gapZones) {
      if (Math.abs(x - gz.center) < GAP_CLEARANCE_X) { skipLabel = true; break; }
    }
    if (skipLabel) continue;

    const isMajor = y % (yearStep * 5) === 0 || y === majorStart || yearStep >= 10;

    const lbl = document.createElement("div");
    lbl.className = "horiz-year-label" + (isMajor ? " major" : "");
    lbl.style.left = x + "px";
    lbl.style.top = axisY + "px";
    lbl.style.transform = "translate(-50%, 14px)";
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
      guide.style.bottom = "0";
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

    // Vertical connector — length based on lane
    const connLen = CONN_BASE + lane * LANE_STEP;
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
