/* ChronoWeave -- Vertical View Renderer */

import { S } from '../state.js';
import { parseDate, formatDate, formatDateRange, impScale, impOpacity, impGlow, eventColor, parseTags } from '../helpers.js';
import { buildCroppedMap } from '../gaps.js';
import { openModal } from '../modal.js';
import { hexAlpha } from '../utils.js';

export function renderVertical(events, container) {
  const wrap = document.createElement('div');
  wrap.className = 'vertical-view';
  container.appendChild(wrap);

  const axis = document.createElement('div');
  axis.className = 'v-axis';
  wrap.appendChild(axis);

  // spine
  const spine = document.createElement('div');
  spine.className = 'v-spine';
  axis.appendChild(spine);

  if (!events.length) return;

  // Collect sorted dates
  const allDates = events
    .map(e => parseDate(e.start_date)?.getTime())
    .filter(Boolean);

  // Build cropped height map
  const CONTAINER_H = 10000; // large virtual height
  const { mapTime, gaps } = S.gapCrop
    ? buildCroppedMap(allDates, {
        thresholdMs: 1000 * 60 * 60 * 24 * 365 * 3,
        containerW: CONTAINER_H,
        paddingPx: 40,
        gapWidthPx: 60,
      })
    : {
        mapTime: buildLinearMap(allDates, CONTAINER_H),
        gaps: [],
      };

  // Track gap break insertions (by position)
  const gapBreaks = new Map();
  gaps.forEach(g => gapBreaks.set(g.start, g));

  // Sort events by start_date
  const sorted = [...events].sort((a, b) => {
    const da = parseDate(a.start_date), db = parseDate(b.start_date);
    if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
    return da - db;
  });

  // Assign vertical positions using gap-cropped map
  const positioned = sorted.map(ev => {
    const d = parseDate(ev.start_date);
    const y = d ? mapTime(d.getTime()) : 0;
    return { ev, y };
  });

  // Determine total height
  const maxY = Math.max(...positioned.map(p => p.y), 200);
  axis.style.height = (maxY + 80) + 'px';
  spine.style.height = maxY + 'px';

  // Insert gap break elements
  gaps.forEach(g => {
    const breakY = g.xStart; // xStart is used as Y in vertical orientation
    const brk = document.createElement('div');
    brk.className = 'v-gap-break';
    brk.style.position = 'absolute';
    brk.style.top = breakY + 'px';
    brk.style.left = '0';
    brk.style.right = '0';
    const lbl = document.createElement('div');
    lbl.className = 'v-gap-label';
    lbl.textContent = g.label;
    brk.appendChild(lbl);
    axis.appendChild(brk);
  });

  // Render events
  positioned.forEach(({ ev, y }, idx) => {
    const side = idx % 2 === 0 ? 'left' : 'right';
    const color = eventColor(ev);
    const scale = impScale(ev.importance);
    const opacity = impOpacity(ev.importance);
    const glow = impGlow(ev.importance);
    const tags = parseTags(ev.tags);

    const entry = document.createElement('div');
    entry.className = `v-entry ${side}`;
    entry.style.position = 'absolute';
    entry.style.top = y + 'px';
    entry.style.left = '0';
    entry.style.right = '0';
    entry.style.transform = `scale(${scale})`;
    entry.style.transformOrigin = side === 'left' ? 'right center' : 'left center';

    // Date column
    const dateCol = document.createElement('div');
    dateCol.className = 'v-date-col';
    dateCol.innerHTML = `<div class="v-date">${formatDateRange(ev.start_date, ev.end_date, ev.date_precision)}</div>`;

    // Dot
    const dot = document.createElement('div');
    dot.className = 'v-dot';
    dot.style.background = color;
    dot.style.borderColor = 'var(--bg)';
    if (glow > 0.3) dot.style.boxShadow = `0 0 ${Math.round(glow * 10)}px ${color}`;

    // Card
    const cardCol = document.createElement('div');
    cardCol.className = 'v-card-col';

    const card = document.createElement('div');
    card.className = 'v-card';
    card.style.borderColor = color;
    card.style.opacity = String(opacity);
    if (glow > 0.4) {
      card.style.boxShadow = `0 0 ${Math.round(glow * 14)}px ${hexAlpha(color, glow * 0.4)}`;
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'v-title';
    titleEl.textContent = ev.title;

    const descEl = document.createElement('div');
    descEl.className = 'v-desc';
    descEl.textContent = ev.description || '';

    card.appendChild(titleEl);
    card.appendChild(descEl);

    if (tags.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'v-tags';
      tags.forEach(t => {
        const span = document.createElement('span');
        span.className = 'v-tag';
        span.textContent = t;
        tagsEl.appendChild(span);
      });
      card.appendChild(tagsEl);
    }

    if (ev.end_date) {
      const bar = document.createElement('div');
      bar.className = 'v-duration-bar';
      bar.style.background = color;
      card.appendChild(bar);
    }

    card.addEventListener('click', () => openModal(ev));
    cardCol.appendChild(card);

    if (side === 'left') {
      entry.appendChild(cardCol);
      entry.appendChild(dot);
      entry.appendChild(dateCol);
    } else {
      entry.appendChild(dateCol);
      entry.appendChild(dot);
      entry.appendChild(cardCol);
    }

    axis.appendChild(entry);
  });
}

function buildLinearMap(dates, containerH, paddingPx = 40) {
  if (!dates.length) return () => paddingPx;
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const span = max - min || 1;
  return (t) => paddingPx + ((t - min) / span) * (containerH - paddingPx * 2);
}
