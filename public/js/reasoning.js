/* ChronoWeave -- Reasoning Panel Logic (Intelligent Display) */

import {
  reasoningOverlay, reasoningPulse, reasoningPhase,
  reasoningStream, reasoningEvents, reasoningTokens,
  reasoningEventCount, reasoningBody, reasoningToggle,
} from './dom.js';
import { esc } from './utils.js';

let _reasoningTokenCount = 0;
let _reasoningEvCount = 0;
let _jsonBuffer = '';
let _parsedEvents = [];
let _streamPhase = 'init'; // init, streaming, done

/**
 * Parse partially-streamed JSON to extract complete event objects.
 * We look for {...} objects containing "title" fields.
 */
function extractCompletedEvents(buffer) {
  const events = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const slice = buffer.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          if (obj.title) events.push(obj);
        } catch { /* incomplete */ }
        start = -1;
      }
    }
  }
  return events;
}

/** Format a single event into a readable insight card */
function renderEventCard(evt, idx) {
  const card = document.createElement('div');
  card.className = 'reasoning-card';
  card.style.animationDelay = `${Math.min(idx * 60, 400)}ms`;

  const date = evt.start_date || '';
  const endDate = evt.end_date ? ` \u2192 ${evt.end_date}` : '';
  const imp = evt.importance || 5;
  const cat = evt.category || '';
  const desc = evt.description || '';

  // Importance dots
  let impDots = '';
  for (let i = 0; i < 10; i++) {
    impDots += `<span class="rc-dot${i < imp ? ' active' : ''}"></span>`;
  }

  card.innerHTML = `
    <div class="rc-header">
      <span class="rc-idx">${idx}</span>
      <span class="rc-date">${esc(date)}${esc(endDate)}</span>
      ${cat ? `<span class="rc-cat">${esc(cat)}</span>` : ''}
    </div>
    <div class="rc-title">${esc(evt.title)}</div>
    <div class="rc-desc">${esc(desc)}</div>
    <div class="rc-importance">${impDots}</div>
  `;
  return card;
}

/** Render a "currently analyzing" shimmer block */
function renderAnalyzingBlock() {
  const block = document.createElement('div');
  block.className = 'reasoning-analyzing';
  block.id = 'reasoningAnalyzing';
  block.innerHTML = `
    <div class="ra-shimmer"></div>
    <div class="ra-text">Analyzing sources and constructing timeline...</div>
  `;
  return block;
}

export function showReasoning() {
  reasoningOverlay.classList.remove("hidden");
  reasoningPulse.className = "reasoning-pulse";
  reasoningPhase.textContent = "Connecting...";
  reasoningStream.innerHTML = "";
  reasoningEvents.innerHTML = "";
  reasoningTokens.textContent = "0 tokens";
  reasoningEventCount.textContent = "0 events";
  reasoningBody.classList.remove("collapsed");
  reasoningToggle.classList.remove("collapsed");
  _reasoningTokenCount = 0;
  _reasoningEvCount = 0;
  _jsonBuffer = '';
  _parsedEvents = [];
  _streamPhase = 'init';

  // Add the analyzing shimmer
  reasoningStream.appendChild(renderAnalyzingBlock());

  lucide.createIcons({ nodes: [reasoningOverlay] });
}

export function hideReasoning() {
  reasoningOverlay.classList.add("hidden");
}

export function appendToken(text) {
  _reasoningTokenCount++;
  _jsonBuffer += text;

  // Update token count periodically
  if (_reasoningTokenCount % 5 === 0) {
    reasoningTokens.textContent = _reasoningTokenCount + " tokens";
  }

  // Try to extract newly completed events from the buffer
  const allEvents = extractCompletedEvents(_jsonBuffer);

  // Render any new events we haven't shown yet
  if (allEvents.length > _parsedEvents.length) {
    // Remove the analyzing block if present (we'll re-add at bottom)
    const analyzing = document.getElementById('reasoningAnalyzing');
    if (analyzing) analyzing.remove();

    for (let i = _parsedEvents.length; i < allEvents.length; i++) {
      const card = renderEventCard(allEvents[i], i + 1);
      reasoningStream.appendChild(card);
    }
    _parsedEvents = allEvents;

    // Re-add analyzing block at bottom if still streaming
    if (_streamPhase !== 'done') {
      reasoningStream.appendChild(renderAnalyzingBlock());
    }

    reasoningBody.scrollTop = reasoningBody.scrollHeight;
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
  _streamPhase = 'done';
  reasoningTokens.textContent = _reasoningTokenCount + " tokens";
  reasoningEventCount.textContent = _reasoningEvCount + " events";

  // Remove analyzing shimmer
  const analyzing = document.getElementById('reasoningAnalyzing');
  if (analyzing) analyzing.remove();

  // If we never got parsed events from the buffer, do a final pass
  if (_parsedEvents.length === 0) {
    const allEvents = extractCompletedEvents(_jsonBuffer);
    allEvents.forEach((evt, i) => {
      const card = renderEventCard(evt, i + 1);
      reasoningStream.appendChild(card);
    });
  }

  // Add a completion summary
  const summary = document.createElement('div');
  summary.className = 'reasoning-summary';
  summary.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5 8.5L7 10.5L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Research complete \u2014 ${_reasoningEvCount} events discovered across ${_reasoningTokenCount.toLocaleString()} tokens</span>
  `;
  reasoningStream.appendChild(summary);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;

  reasoningPulse.classList.add("done");
  reasoningPhase.textContent = "Timeline ready";
}

export function reasoningError(msg) {
  _streamPhase = 'done';
  const analyzing = document.getElementById('reasoningAnalyzing');
  if (analyzing) analyzing.remove();

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
  _streamPhase = 'done';
  const analyzing = document.getElementById('reasoningAnalyzing');
  if (analyzing) analyzing.remove();

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
