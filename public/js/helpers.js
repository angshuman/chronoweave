/* ChronoWeave -- Date & Event Helpers */

import { S } from './state.js';
import { esc } from './utils.js';

// -- Date parsing & formatting ----------------------------------------------

export function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return new Date(parseInt(s), 0, 1).getTime();
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).getTime();
  }
  return new Date(s + "T00:00:00").getTime();
}

export function fmtDate(s) {
  if (!s) return "?";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-");
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  }
  try {
    const d = new Date(s + "T00:00:00");
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch { return s; }
}

export function fmtDateRange(evt) {
  const start = fmtDate(evt.start_date);
  if (!evt.end_date || evt.end_date === evt.start_date) return start;
  const end = fmtDate(evt.end_date);
  return `${start} → ${end}`;
}

// -- Event color ------------------------------------------------------------

export function evtColor(evt) {
  if (evt.source_color && evt.source_color.startsWith("[")) {
    try { return JSON.parse(evt.source_color)[0] || (evt._tl ? evt._tl.color : '#6e7bf2'); } catch { /* ignore */ }
  }
  return evt.source_color || (evt._tl ? evt._tl.color : '#6e7bf2');
}

// -- Source dots / labels (for merged events) -------------------------------

export function sourceDotsHtml(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color || "[]");
      return `<span class="list-source-dots">${srcs.map((s, i) =>
        `<span class="sdot" style="background:${cols[i]?.color || cols[i] || "#6e7bf2"}" title="${esc(s.name || s)}"></span>`
      ).join("")}</span>`;
    } catch { /* ignore */ }
  }
  return "";
}

export function sourceDotsSmall(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color || "[]");
      return `<span class="sdots">${srcs.map((s, i) =>
        `<span class="sdot" style="background:${cols[i]?.color || cols[i] || "#6e7bf2"}"></span>`
      ).join("")}</span>`;
    } catch { /* ignore */ }
  }
  return "";
}

export function sourceLabel(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      return `<span class="list-source-label">From: ${srcs.map(s => s.name || s).join(", ")}</span>`;
    } catch { /* ignore */ }
  }
  if (evt._tl && evt._tl.is_merged && evt.source_timeline_name && !evt.source_timeline_name.startsWith("[")) {
    return `<span class="list-source-label">From: ${esc(evt.source_timeline_name)}</span>`;
  }
  return "";
}

// -- Importance scaling -----------------------------------------------------

export function impScale(imp) {
  const t = (imp - 1) / 9; // 0..1
  return {
    cardPad: Math.round(6 + t * 8),
    titleSize: Math.round(11 + t * 5),
    descSize: Math.round(10 + t * 4),
    dotSize: Math.round(7 + t * 7),
    opacity: +(0.45 + t * 0.55).toFixed(2),
    titleWeight: t < 0.4 ? 500 : (t < 0.7 ? 600 : 700),
    glow: imp >= 7,
    barTitleSize: Math.round(11 + t * 3),
  };
}

// -- Year step for axis labels ----------------------------------------------

export function getYearStep(yearRange, zoom) {
  const effectiveRange = yearRange / zoom;
  if (effectiveRange > 200) return 50;
  if (effectiveRange > 100) return 20;
  if (effectiveRange > 50) return 10;
  if (effectiveRange > 20) return 5;
  if (effectiveRange > 10) return 2;
  return 1;
}

// -- Free lane finder -------------------------------------------------------

export function findFreeLane(laneEnds, start) {
  for (let l = 0; l < laneEnds.length; l++) {
    if (start >= laneEnds[l]) return l;
  }
  return laneEnds.length;
}

// -- Cluster builder for hidden events --------------------------------------

export function buildClusters(hiddenEvts, visibleParsed, posFunc, axis) {
  if (!hiddenEvts.length) return [];
  const hiddenParsed = hiddenEvts
    .map(e => ({ ...e, _ts: parseDate(e.start_date) }))
    .filter(e => e._ts)
    .sort((a, b) => a._ts - b._ts);
  if (!hiddenParsed.length) return [];
  const clusters = [];
  let current = { events: [hiddenParsed[0]], ts: hiddenParsed[0]._ts };
  const clusterThreshold = axis === "horizontal" ? 100 / (S.zoom || 1) : 60 / (S.zoom || 1);
  for (let i = 1; i < hiddenParsed.length; i++) {
    const e = hiddenParsed[i];
    const pos = posFunc(e._ts);
    const prevPos = posFunc(current.events[current.events.length - 1]._ts);
    if (Math.abs(pos - prevPos) < clusterThreshold) {
      current.events.push(e);
    } else {
      clusters.push(current);
      current = { events: [e], ts: e._ts };
    }
  }
  clusters.push(current);
  return clusters.map(cl => {
    const midTs = cl.events[Math.floor(cl.events.length / 2)]._ts;
    const pos = posFunc(midTs);
    return {
      count: cl.events.length,
      label: cl.events.length === 1 ? "hidden event" : "hidden events",
      titles: cl.events.map(e => `[${e.importance || 5}] ${e.title}`),
      x: axis === "horizontal" ? pos : 0,
      y: axis === "vertical" ? pos : 0,
    };
  });
}
