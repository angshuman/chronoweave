/* ChronoWeave — Reasoning Panel Logic */

import {
  reasoningOverlay, reasoningPulse, reasoningPhase,
  reasoningStream, reasoningEvents, reasoningTokens,
  reasoningEventCount, reasoningBody, reasoningToggle,
} from './dom.js';
import { esc } from './utils.js';

let _reasoningTokenCount = 0;
let _reasoningEvCount = 0;

export function showReasoning() {
  reasoningOverlay.classList.remove("hidden");
  reasoningPulse.className = "reasoning-pulse";
  reasoningPhase.textContent = "Connecting...";
  reasoningStream.textContent = "";
  reasoningEvents.innerHTML = "";
  reasoningTokens.textContent = "0 tokens";
  reasoningEventCount.textContent = "0 events";
  reasoningBody.classList.remove("collapsed");
  reasoningToggle.classList.remove("collapsed");
  _reasoningTokenCount = 0;
  _reasoningEvCount = 0;
  lucide.createIcons({ nodes: [reasoningOverlay] });
}

export function hideReasoning() {
  reasoningOverlay.classList.add("hidden");
}

export function appendToken(text) {
  let cursor = reasoningStream.querySelector(".token-cursor");
  if (cursor) cursor.remove();
  reasoningStream.appendChild(document.createTextNode(text));
  cursor = document.createElement("span");
  cursor.className = "token-cursor";
  reasoningStream.appendChild(cursor);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;
  _reasoningTokenCount++;
  if (_reasoningTokenCount % 5 === 0) {
    reasoningTokens.textContent = _reasoningTokenCount + " tokens";
  }
}

export function addEventPill(idx, title) {
  _reasoningEvCount = idx;
  reasoningEventCount.textContent = idx + " event" + (idx !== 1 ? "s" : "");
  const pill = document.createElement("span");
  pill.className = "reasoning-ev-pill";
  pill.innerHTML = `<span class="pill-num">${idx}</span>${esc(title)}`;
  reasoningEvents.appendChild(pill);
  reasoningEvents.scrollTop = reasoningEvents.scrollHeight;
}

export function finalizeReasoning() {
  reasoningTokens.textContent = _reasoningTokenCount + " tokens";
  reasoningEventCount.textContent = _reasoningEvCount + " events";
  const cursor = reasoningStream.querySelector(".token-cursor");
  if (cursor) cursor.remove();
  reasoningPulse.classList.add("done");
  reasoningPhase.textContent = "Timeline ready";
}

export function reasoningError(msg) {
  const cursor = reasoningStream.querySelector(".token-cursor");
  if (cursor) cursor.remove();
  reasoningPulse.classList.add("error");
  reasoningPhase.textContent = "Error: " + msg;
  reasoningOverlay.addEventListener("click", function dismiss(ev) {
    if (ev.target === reasoningOverlay) {
      hideReasoning();
      reasoningOverlay.removeEventListener("click", dismiss);
    }
  });
}

export function reasoningConnectionLost() {
  const cursor = reasoningStream.querySelector(".token-cursor");
  if (cursor) cursor.remove();
  reasoningPulse.classList.add("error");
  reasoningPhase.textContent = "Connection lost";
  reasoningOverlay.addEventListener("click", function dismiss(ev) {
    if (ev.target === reasoningOverlay) {
      hideReasoning();
      reasoningOverlay.removeEventListener("click", dismiss);
    }
  });
}

// Toggle binding
reasoningToggle.addEventListener("click", () => {
  reasoningBody.classList.toggle("collapsed");
  reasoningToggle.classList.toggle("collapsed");
});
