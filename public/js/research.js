/* ChronoWeave -- Research (SSE Streaming) */

import { S, API } from './state.js';
import { reasoningPhase } from './dom.js';
import { getToken } from './auth.js';
import { updateCredits, showPricingModal } from './account.js';
import {
  showReasoning, hideReasoning, appendToken,
  addEventPill, finalizeReasoning, reasoningError,
  reasoningConnectionLost, setIntent, addSearchProgress,
  searchComplete,
} from './reasoning.js';
import { loadTimelines } from './sessions.js';
import { loadSessions } from './sessions.js';
import { nextColor } from './state.js';

export async function doResearch(query) {
  if (!query || !S.activeId) return;
  showReasoning();
  const color = nextColor();
  const params = new URLSearchParams({ session_id: S.activeId, query, color });
  // Include auth token as query param for SSE (EventSource doesn't support headers)
  const token = getToken();
  if (token) params.set("token", token);
  const es = new EventSource(`${API}/api/research/stream?${params}`);

  es.addEventListener("status", e => {
    const d = JSON.parse(e.data);
    reasoningPhase.textContent = d.message;
  });

  es.addEventListener("intent", e => {
    const d = JSON.parse(e.data);
    setIntent(d.intent, d.summary);
  });

  es.addEventListener("credits", e => {
    const d = JSON.parse(e.data);
    updateCredits(d.balance);
  });

  es.addEventListener("search_progress", e => {
    const d = JSON.parse(e.data);
    addSearchProgress(d.message);
  });

  es.addEventListener("search_complete", e => {
    const d = JSON.parse(e.data);
    searchComplete(d.queries_completed, d.queries_total);
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
    let code = null;
    try {
      if (e.data) {
        const d = JSON.parse(e.data);
        msg = d.message || msg;
        code = d.code;
      }
    } catch {}
    es.close();

    if (code === "INSUFFICIENT_CREDITS") {
      reasoningError(msg);
      setTimeout(() => {
        hideReasoning();
        showPricingModal();
      }, 1500);
    } else {
      reasoningError(msg);
    }
  });

  es.addEventListener("done", () => { es.close(); });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    reasoningConnectionLost();
  };
}
