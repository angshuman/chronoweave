/* ChronoWeave -- Research (SSE Streaming) */

import { S, API } from './state.js';
import { reasoningPhase } from './dom.js';
import {
  showReasoning, hideReasoning, appendToken,
  addEventPill, finalizeReasoning, reasoningError,
  reasoningConnectionLost,
} from './reasoning.js';
import { loadTimelines } from './sessions.js';
import { loadSessions } from './sessions.js';
import { nextColor } from './state.js';

export async function doResearch(query) {
  if (!query || !S.activeId) return;
  showReasoning();
  const color = nextColor();
  const params = new URLSearchParams({ session_id: S.activeId, query, color });
  const es = new EventSource(`${API}/api/research/stream?${params}`);

  es.addEventListener("status", e => {
    const d = JSON.parse(e.data);
    reasoningPhase.textContent = d.message;
  });

  es.addEventListener("token", e => {
    const d = JSON.parse(e.data);
    appendToken(d.text);
  });

  es.addEventListener("event_found", e => {
    const d = JSON.parse(e.data);
    addEventPill(d.index, d.title);
  });

  es.addEventListener("result", async () => {
    es.close();
    finalizeReasoning();
    await loadTimelines();
    await loadSessions();
    setTimeout(() => hideReasoning(), 800);
  });

  es.addEventListener("error", e => {
    let msg = "Connection error";
    try { if (e.data) { const d = JSON.parse(e.data); msg = d.message || msg; } } catch {}
    es.close();
    reasoningError(msg);
  });

  es.addEventListener("done", () => { es.close(); });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    reasoningConnectionLost();
  };
}
