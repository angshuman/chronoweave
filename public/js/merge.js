/* ChronoWeave -- Merge Logic */

import { S } from './state.js';
import { apiFetch } from './api.js';
import { renderChips } from './sessions.js';
import { renderView } from './render.js';
import { btnMerge } from './dom.js';

export function initMerge() {
  btnMerge.addEventListener('click', async () => {
    const ids = [...S.selectedTimelines];
    if (ids.length < 2) return;
    btnMerge.disabled = true;
    btnMerge.textContent = 'Merging...';
    try {
      const merged = await apiFetch('/api/merge', {
        method: 'POST',
        body: JSON.stringify({ session_id: S.sessionId, timeline_ids: ids }),
      });
      S.timelines.push(merged);
      S.visibleTimelines.push(merged.id);
      renderChips();
      renderView();
    } finally {
      btnMerge.disabled = false;
      btnMerge.textContent = 'Merge';
    }
  });
}
