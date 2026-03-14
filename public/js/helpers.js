/* ChronoWeave -- Date & Event Helpers */

import { S } from './state.js';

/**
 * Parse an ISO-ish date string (YYYY, YYYY-MM, YYYY-MM-DD) to a Date object.
 * Returns null for invalid dates.
 */
export function parseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  // YYYY
  if (/^\d{4}$/.test(str))          return new Date(+str, 0, 1);
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [y, m] = str.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Fallback
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

/**
 * Format a date for display based on precision.
 */
export function formatDate(str, precision = 'day') {
  const d = parseDate(str);
  if (!d) return str || '';
  if (precision === 'year')  return d.getFullYear().toString();
  if (precision === 'month') return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format a date range: "Jan 2020 - Dec 2022"
 */
export function formatDateRange(start, end, precision) {
  if (!end) return formatDate(start, precision);
  return `${formatDate(start, precision)} - ${formatDate(end, precision)}`;
}

/**
 * Importance -> visual scale factor (0.75 .. 1.0)
 * Used to scale card sizes, font opacity, etc.
 */
export function impScale(imp) {
  const v = Math.max(1, Math.min(10, imp || 5));
  return 0.75 + (v - 1) * (0.25 / 9);
}

/**
 * Importance -> opacity (0.55 .. 1.0)
 */
export function impOpacity(imp) {
  const v = Math.max(1, Math.min(10, imp || 5));
  return 0.55 + (v - 1) * (0.45 / 9);
}

/**
 * Importance -> glow intensity (0 .. 1)
 */
export function impGlow(imp) {
  const v = Math.max(1, Math.min(10, imp || 5));
  return (v - 1) / 9;
}

/**
 * Given a list of visible timeline IDs and the current session timelines,
 * return all events (deduped by ID, sorted by start_date) for visible timelines.
 */
export function gatherEvents() {
  const visIds = new Set(S.visibleTimelines);
  const all = [];
  const seen = new Set();
  for (const tl of S.timelines) {
    if (!visIds.has(tl.id)) continue;
    for (const ev of (tl.events || [])) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        all.push({ ...ev, _tlColor: tl.color });
      }
    }
  }
  all.sort((a, b) => {
    const da = parseDate(a.start_date), db = parseDate(b.start_date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
  return all;
}

/**
 * Filter events by minimum importance.
 */
export function filterByImportance(events) {
  return events.filter(e => (e.importance || 5) >= S.minImportance);
}

/**
 * Source label from an event (handles merged multi-source).
 */
export function sourceLabel(ev) {
  if (!ev.source_timeline_name) return '';
  try {
    const arr = JSON.parse(ev.source_timeline_name);
    if (Array.isArray(arr)) return arr.map(x => x.name || '?').join(', ');
  } catch {}
  return ev.source_timeline_name;
}

/**
 * Color for an event dot/card border.
 */
export function eventColor(ev) {
  if (!ev.source_color) return ev._tlColor || 'var(--accent)';
  try {
    const arr = JSON.parse(ev.source_color);
    if (Array.isArray(arr)) return arr[0] || 'var(--accent)';
  } catch {}
  return ev.source_color || ev._tlColor || 'var(--accent)';
}

/**
 * Parse tags (stored as JSON string or array).
 */
export function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags); } catch { return []; }
}
