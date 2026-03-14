/* ChronoWeave — Merge Logic */

import { S } from './state.js';
import { api, showLoader, hideLoader } from './api.js';
import { loadTimelines, loadSessions } from './sessions.js';

export async function doMerge() {
  const ids = [...S.selected];
  if (ids.length < 2) return;
  showLoader("Merging timelines...");
  try {
    await api("/api/merge", { method: "POST", body: JSON.stringify({ session_id: S.activeId, timeline_ids: ids }) });
    S.selected.clear();
    await loadTimelines();
    await loadSessions();
  } catch (e) {
    alert("Merge failed: " + e.message);
  } finally {
    hideLoader();
  }
}
