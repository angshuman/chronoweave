/* ChronoWeave -- Render View Dispatcher */

import { S } from './state.js';
import { canvas } from './dom.js';
import { renderListView } from './views/list.js';
import { renderLinearView } from './views/vertical.js';
import { renderHorizontalView } from './views/horizontal.js';
import { autoImportanceThreshold } from './zoom.js';

export function renderView() {
  canvas.innerHTML = "";
  if (!S.timelines.length) {
    canvas.innerHTML = '<div class="empty-note">Research a topic below to create your first timeline</div>';
    return;
  }
  const allEvts = gatherEvents();
  // Use the more restrictive of manual filter and auto zoom-based threshold
  const autoThreshold = autoImportanceThreshold(S.zoom);
  const effectiveMin = Math.max(S.minImportance, autoThreshold);
  const filtered = effectiveMin > 0
    ? allEvts.filter(e => (e.importance || 5) >= effectiveMin)
    : allEvts;
  const hiddenCount = allEvts.length - filtered.length;

  if (S.view === "list") renderListView(filtered, hiddenCount, canvas);
  else if (S.view === "horizontal") renderHorizontalView(filtered, hiddenCount, allEvts, canvas);
  else renderLinearView(filtered, hiddenCount, allEvts, canvas);
}

function gatherEvents() {
  // Build set of timeline IDs that have been merged into another timeline
  // so we don't double-count events from both the source and merged timelines
  const mergedSourceIds = new Set();
  S.timelines.forEach(tl => {
    if (tl.is_merged && Array.isArray(tl.merged_from)) {
      tl.merged_from.forEach(id => mergedSourceIds.add(id));
    }
  });

  const all = [];
  S.timelines.forEach(tl => {
    // Skip source timelines whose events already exist in a merged timeline
    if (mergedSourceIds.has(tl.id)) return;
    (tl.events || []).forEach(e => all.push({ ...e, _tl: tl }));
  });
  all.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  return all;
}
