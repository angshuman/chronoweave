/* ChronoWeave -- Horizontal View Renderer */

import { S } from '../state.js';
import { parseDate, formatDate, impScale, impOpacity, impGlow, eventColor, parseTags } from '../helpers.js';
import { buildCroppedMap } from '../gaps.js';
import { openModal } from '../modal.js';
import { hexAlpha } from '../utils.js';

export function renderHorizontal(events, container) {
  const wrap = document.createElement('div');
  wrap.className = 'horizontal-view';

  const scroll = document.createElement('div');
  scroll.className = 'h-scroll';
  wrap.appendChild(scroll);
  container.appendChild(wrap);

  // Axis Y position (fraction of container height)
  const AXIS_FRAC = 0.42;

  // Card dimensions base
  const CARD_W_BASE = 120;
  const CARD_H_BASE = 80;

  // Lane height for above/below stacking
  const LANE_H = 90;

  function build() {
    scroll.innerHTML = '';

    const containerW = Math.max(scroll.clientWidth || 1200, 800) * S.zoom;
    const containerH = Math.max(scroll.clientHeight || 500, 400);
    const axisY = containerH * AXIS_FRAC;

    const stage = document.createElement('div');
    stage.className = 'h-stage';
    stage.style.width = containerW + 'px';
    stage.style.height = containerH + 'px';
    scroll.appendChild(stage);

    // Collect dates
    const allDates = events.map(e => parseDate(e.start_date)?.getTime()).filter(Boolean);

    // Build cropped map
    const { mapTime, gaps, totalWidth } = S.gapCrop
      ? buildCroppedMap(allDates, {
          thresholdMs: 1000 * 60 * 60 * 24 * 365 * 3,
          containerW,
        })
      : {
          mapTime: buildLinearMap(allDates, containerW),
          gaps: [],
          totalWidth: containerW,
        };

    stage.style.width = totalWidth + 'px';

    // Axis line
    const axisLine = document.createElement('div');
    axisLine.className = 'h-axis-line';
    axisLine.style.top = axisY + 'px';
    stage.appendChild(axisLine);

    // Gap break indicators
    gaps.forEach(g => {
      const mid = (g.xStart + g.xEnd) / 2;
      const line = document.createElement('div');
      line.className = 'h-gap-break';
      line.style.left = mid + 'px';
      line.style.top = '0';
      line.style.bottom = '0';
      stage.appendChild(line);

      const lbl = document.createElement('div');
      lbl.className = 'h-gap-label';
      lbl.textContent = g.label;
      lbl.style.left = mid + 'px';
      lbl.style.top = (axisY - 18) + 'px';
      stage.appendChild(lbl);
    });

    // Lane assignment: alternate above/below axis
    // above = lane 0,1,2... (each offset by LANE_H upward)
    // below = lane 0,1,2... (each offset by LANE_H downward)
    const aboveLanes = []; // sorted by x, tracks rightmost x of each lane
    const belowLanes = [];

    events.forEach((ev, idx) => {
      const d = parseDate(ev.start_date);
      if (!d) return;
      const x = mapTime(d.getTime());

      const scale = impScale(ev.importance);
      const cardW = Math.round(CARD_W_BASE * scale);
      const cardH = Math.round(CARD_H_BASE * scale);
      const color = eventColor(ev);
      const opacity = impOpacity(ev.importance);
      const glow = impGlow(ev.importance);

      // Duration bar
      if (ev.end_date) {
        const endD = parseDate(ev.end_date);
        if (endD) {
          const x2 = mapTime(endD.getTime());
          const bar = document.createElement('div');
          bar.className = 'h-duration-bar';
          bar.style.left = Math.min(x, x2) + 'px';
          bar.style.width = Math.abs(x2 - x) + 'px';
          bar.style.top = (axisY - 3) + 'px';
          bar.style.background = color;
          stage.appendChild(bar);
        }
      }

      // Axis dot
      const dot = document.createElement('div');
      dot.className = 'h-dot';
      dot.style.left = x + 'px';
      dot.style.top = axisY + 'px';
      dot.style.background = color;
      if (glow > 0.3) dot.style.boxShadow = `0 0 ${Math.round(glow * 8)}px ${color}`;
      stage.appendChild(dot);

      // Assign lane
      const above = idx % 2 === 0;
      const lanes = above ? aboveLanes : belowLanes;
      let lane = 0;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] < x - 8) { lane = i; break; }
        lane = i + 1;
      }
      while (lanes.length <= lane) lanes.push(-Infinity);
      lanes[lane] = x + cardW + 8;

      const CONNECTOR_H = 20 + lane * LANE_H;
      const cardY = above
        ? axisY - CONNECTOR_H - cardH
        : axisY + CONNECTOR_H;

      // Connector
      const conn = document.createElement('div');
      conn.className = 'h-connector';
      conn.style.left = x + 'px';
      conn.style.top = above ? (cardY + cardH) + 'px' : axisY + 'px';
      conn.style.height = CONNECTOR_H + 'px';
      stage.appendChild(conn);

      // Card
      const card = document.createElement('div');
      card.className = 'h-card';
      card.style.left = (x - cardW / 2) + 'px';
      card.style.top = cardY + 'px';
      card.style.width = cardW + 'px';
      card.style.minHeight = cardH + 'px';
      card.style.borderColor = color;
      card.style.opacity = String(opacity);
      if (glow > 0.4) {
        card.style.boxShadow = `0 0 ${Math.round(glow * 12)}px ${hexAlpha(color, glow * 0.5)}`;
      }

      card.innerHTML = `
        <div class="h-card-title">${esc(ev.title)}</div>
        <div class="h-card-date">${formatDate(ev.start_date, ev.date_precision)}</div>
      `;
      card.addEventListener('click', () => openModal(ev));
      stage.appendChild(card);
    });
  }

  build();

  // Rebuild on resize
  const ro = new ResizeObserver(() => build());
  ro.observe(scroll);
}

function buildLinearMap(dates, containerW, paddingPx = 60) {
  if (!dates.length) return () => paddingPx;
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const span = max - min || 1;
  return (t) => paddingPx + ((t - min) / span) * (containerW - paddingPx * 2);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
