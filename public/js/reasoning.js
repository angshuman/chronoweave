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
let _streamPhase = 'init'; // init, searching, streaming, done

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

  lucide.createIcons({ nodes: [reasoningOverlay] });
}

export function hideReasoning() {
  reasoningOverlay.classList.add("hidden");
}

/** Display intent classification (lightweight badge) */
export function setIntent(intent, summary) {
  const badge = document.createElement('div');
  badge.className = 'reasoning-intent';

  const icons = {
    research: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    refine: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    navigate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
    display: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    question: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  };
  const labels = {
    research: 'New Research',
    refine: 'Follow-up',
    navigate: 'Navigate',
    display: 'Display',
    question: 'Question',
    edit: 'Edit',
  };

  const icon = icons[intent] || icons.research;
  const label = labels[intent] || 'Processing';
  badge.innerHTML = `${icon}<span class="ri-label">${label}</span><span class="ri-summary">${esc(summary)}</span>`;
  reasoningStream.appendChild(badge);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;
}

/** Show a question answer in the reasoning panel */
export function showAnswer(text) {
  _streamPhase = 'done';
  const analyzing = document.getElementById('reasoningAnalyzing');
  if (analyzing) analyzing.remove();

  const answer = document.createElement('div');
  answer.className = 'reasoning-summary';
  answer.style.cssText = 'flex-direction:column;align-items:flex-start;gap:8px;padding:12px';
  answer.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;opacity:0.7;font-size:11px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Answer
    </div>
    <div style="font-size:13px;line-height:1.5">${esc(text)}</div>
  `;
  reasoningStream.appendChild(answer);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;

  reasoningPulse.classList.add("done");
  reasoningPhase.textContent = "Question answered";
  reasoningTokens.textContent = "";
  reasoningEventCount.textContent = "";
}

/** Show edit result confirmation in the reasoning panel */
export function showEditResult(removed, updated) {
  _streamPhase = 'done';
  const analyzing = document.getElementById('reasoningAnalyzing');
  if (analyzing) analyzing.remove();

  let msg;
  if (removed) msg = `Removed ${removed} event${removed !== 1 ? 's' : ''} from timeline`;
  else if (updated) msg = `Updated ${updated} event${updated !== 1 ? 's' : ''}`;
  else msg = 'Edit applied';

  const summary = document.createElement('div');
  summary.className = 'reasoning-summary';
  summary.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5 8.5L7 10.5L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>${esc(msg)}</span>
  `;
  reasoningStream.appendChild(summary);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;

  reasoningPulse.classList.add("done");
  reasoningPhase.textContent = msg;
  reasoningTokens.textContent = "";
  reasoningEventCount.textContent = "";
}

/** Add a search progress message (only shown when web search is triggered) */
export function addSearchProgress(message) {
  _streamPhase = 'searching';

  // Add search header if not yet present
  if (!document.getElementById('searchSection')) {
    const searchHeader = document.createElement('div');
    searchHeader.className = 'reasoning-search-header';
    searchHeader.id = 'searchSection';
    searchHeader.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9"/></svg>
      <span>Searching the web</span>
    `;
    reasoningStream.appendChild(searchHeader);
  }

  const step = document.createElement('div');
  step.className = 'reasoning-search-step';
  step.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
    <span>${esc(message)}</span>
  `;
  reasoningStream.appendChild(step);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;
}

/** Search phase complete */
export function searchComplete(completed, total) {
  const divider = document.createElement('div');
  divider.className = 'reasoning-search-done';
  divider.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5 8.5L7 10.5L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Web search complete — using results for accuracy</span>
  `;
  reasoningStream.appendChild(divider);
  reasoningBody.scrollTop = reasoningBody.scrollHeight;
}

export function appendToken(text) {
  _reasoningTokenCount++;
  _jsonBuffer += text;

  // If we haven't added the analyzing block yet, add it
  if (_streamPhase === 'init' || _streamPhase === 'searching') {
    _streamPhase = 'streaming';
    if (!document.getElementById('reasoningAnalyzing')) {
      reasoningStream.appendChild(renderAnalyzingBlock());
    }
  }

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
