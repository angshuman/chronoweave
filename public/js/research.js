/* ChronoWeave -- Research (SSE Streaming) */

import { S, API } from './state.js';
import { reasoningPhase } from './dom.js';
import { getToken } from './auth.js';
import { updateCredits, showPricingModal } from './account.js';
import {
  showReasoning, hideReasoning, appendToken,
  addEventPill, finalizeReasoning, reasoningError,
  reasoningConnectionLost, setIntent, addSearchProgress,
  searchComplete, showAnswer, showEditResult, showSuggestions,
} from './reasoning.js';
import { loadTimelines } from './sessions.js';
import { loadSessions } from './sessions.js';
import { nextColor } from './state.js';
import { renderView } from './render.js';
import { setZoom, zoomIn, zoomOut } from './zoom.js';
import { setMinImportance } from './density.js';

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

  // Handle client-side actions (navigate, display) — no LLM call needed
  es.addEventListener("client_action", e => {
    const d = JSON.parse(e.data);
    es.close();

    if (d.action === "navigate") {
      if (d.zoomDirection === "in") zoomIn();
      else if (d.zoomDirection === "out") zoomOut();
      // TODO: scroll-to-year could be added here if views support it
    } else if (d.action === "display") {
      if (d.view) {
        S.view = d.view;
        document.querySelectorAll(".view-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.view === d.view)
        );
      }
      if (d.minImportance !== undefined) setMinImportance(d.minImportance);
      if (d.zoomDirection === "in") zoomIn();
      else if (d.zoomDirection === "out") zoomOut();
      if (d.view && d.minImportance === undefined) renderView();
    }

    setTimeout(() => hideReasoning(), 600);
  });

  // Handle question answers — display inline, no timeline reload
  es.addEventListener("answer", e => {
    const d = JSON.parse(e.data);
    es.close();
    showAnswer(d.text);
    // auto-dismiss after a long delay so user can read
    setTimeout(() => hideReasoning(), 12000);
  });

  es.addEventListener("result", async e => {
    const d = JSON.parse(e.data);

    if (d.edited) {
      // Edit result — reload timelines to reflect changes
      es.close();
      showEditResult(d.removed, d.updated);
      await loadTimelines();
      await loadSessions();
      renderView();
      setTimeout(() => hideReasoning(), 2000);
    } else {
      // Normal research/refine result — keep ES open for suggestions
      finalizeReasoning();
      await loadTimelines();
      await loadSessions();
      // Auto-close after timeout if no suggestions arrive
      es._hideTimer = setTimeout(() => { es.close(); hideReasoning(); }, 4000);
    }
  });

  es.addEventListener("suggestions", e => {
    const d = JSON.parse(e.data);
    es.close();
    if (es._hideTimer) clearTimeout(es._hideTimer);
    showSuggestions(d.suggestions, doResearch);
    setTimeout(() => hideReasoning(), 800);
  });

  es.addEventListener("error", e => {
    let msg = "Something went wrong";
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
    reasoningError("Lost connection to server. Please try again.");
  };
}
