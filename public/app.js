/* ChronoWeave — Timeline Research App */

const API = ""; // relative — works on localhost:8000 (Express) and Vercel

// ── State ──────────────────────────────────────────────────────────────────
const S = {
  sessions: [],
  activeId: null,
  timelines: [],
  selected: new Set(),
  view: "linear",
  zoom: 1.0,
  minImportance: 0,
  theme: "midnight",
};

const COLORS = ["#6e7bf2","#f87171","#4ade80","#fb923c","#a78bfa","#22d3ee","#e8af34","#f472b6","#38bdf8","#a3e635"];
let colorIdx = 0;
function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

const ZOOM_STEPS = [0.15, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0];

const GAP_BREAK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 4l6 4-6 4"/><path d="M8 4l6 4-6 4"/></svg>';

// ── DOM Refs ───────────────────────────────────────────────────────────────
const _$ = s => document.querySelector(s);
const landing = _$("#landing");
const sessionView = _$("#sessionView");
const sessionNav = _$("#sessionNav");
const topbarTitle = _$("#topbarTitle");
const chipsBar = _$("#chipsBar");
const canvas = _$("#canvas");
const canvasWrap = _$("#canvasWrap");
const loaderBg = _$("#loaderBg");
const loaderText = _$("#loaderText");
const reasoningOverlay = _$("#reasoningOverlay");
const reasoningPhase = _$("#reasoningPhase");
const reasoningPulse = _$("#reasoningPulse");
const reasoningBody = _$("#reasoningBody");
const reasoningStream = _$("#reasoningStream");
const reasoningEvents = _$("#reasoningEvents");
const reasoningTokens = _$("#reasoningTokens");
const reasoningEventCount = _$("#reasoningEventCount");
const reasoningToggle = _$("#reasoningToggle");
const modalBg = _$("#modalBg");
const viewSwitch = _$("#viewSwitch");
const mergeBtn = _$("#mergeBtn");
const sidebar = _$("#sidebar");
const zoomLevelEl = _$("#zoomLevel");
const densityDropdown = _$("#densityDropdown");
const densityLabel = _$("#densityLabel");

// ── API Helper ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { headers: {"Content-Type":"application/json",...opts.headers}, ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({detail:r.statusText})); throw new Error(e.detail||"Error"); }
  return r.json();
}
function showLoader(t) { loaderText.textContent = t; loaderBg.classList.remove("hidden"); }
function hideLoader() { loaderBg.classList.add("hidden"); }

// ── Storage helpers (safe in sandboxed iframes) ───────────────────────────
const _LS = (() => { try { return window["local"+"Storage"]; } catch { return null; } })();
function storeSet(k, v) { try { if (_LS) _LS.setItem(k, v); } catch { /* sandboxed */ } }
function storeGet(k) { try { return _LS ? _LS.getItem(k) : null; } catch { return null; } }

// ── Theme System ───────────────────────────────────────────────────────────
function setTheme(name) {
  S.theme = name;
  document.documentElement.setAttribute("data-theme", name);
  document.querySelectorAll(".theme-dot").forEach(d => {
    d.classList.toggle("active", d.dataset.theme === name);
  });
  storeSet("chronoweave-theme", name);
}

function initTheme() {
  const saved = storeGet("chronoweave-theme");
  setTheme(saved || "midnight");
}

document.querySelectorAll(".theme-dot").forEach(dot => {
  dot.addEventListener("click", () => setTheme(dot.dataset.theme));
});

// ── Sessions ───────────────────────────────────────────────────────────────
async function loadSessions() { S.sessions = await api("/api/sessions"); renderSessions(); }

function renderSessions() {
  sessionNav.innerHTML = "";
  if (!S.sessions.length) { sessionNav.innerHTML = '<div class="empty-note" style="padding:20px;font-size:12px">No threads yet</div>'; return; }
  S.sessions.forEach(s => {
    const el = document.createElement("div");
    el.className = `nav-item${s.id===S.activeId?" active":""}`;
    el.innerHTML = `<span class="nav-name">${esc(s.name)}</span><span class="nav-count">${s.timeline_count||0}</span><button class="nav-del" data-id="${s.id}" aria-label="Delete"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>`;
    el.addEventListener("click", e => { if (e.target.closest(".nav-del")) return; selectSession(s.id); });
    el.querySelector(".nav-del").addEventListener("click", async e => {
      e.stopPropagation();
      await api(`/api/sessions/${s.id}`, {method:"DELETE"});
      if (S.activeId===s.id) { S.activeId=null; S.timelines=[]; showLanding(); }
      await loadSessions();
    });
    sessionNav.appendChild(el);
  });
  lucide.createIcons({nodes:[sessionNav]});
}

async function createSession(initialQuery) {
  const name = initialQuery ? initialQuery.slice(0,50) : `Thread ${S.sessions.length+1}`;
  const s = await api("/api/sessions", {method:"POST", body:JSON.stringify({name})});
  await loadSessions();
  await selectSession(s.id);
  if (initialQuery) await doResearch(initialQuery);
}

async function selectSession(id) {
  S.activeId = id; S.selected.clear(); colorIdx = 0;
  const sess = S.sessions.find(s=>s.id===id);
  topbarTitle.textContent = sess ? sess.name : "Thread";
  landing.classList.add("hidden"); sessionView.classList.remove("hidden");
  await loadTimelines();
  renderSessions();
  sidebar.classList.remove("open");
}

function showLanding() { landing.classList.remove("hidden"); sessionView.classList.add("hidden"); }

// ── Timelines ──────────────────────────────────────────────────────────────
async function loadTimelines() {
  if (!S.activeId) return;
  S.timelines = await api(`/api/sessions/${S.activeId}/timelines`);
  renderChips(); renderView();
}

function renderChips() {
  chipsBar.innerHTML = "";
  S.timelines.forEach(tl => {
    const sel = S.selected.has(tl.id);
    const ch = document.createElement("div");
    ch.className = `chip${sel?" selected":""}`;
    ch.style.background = sel ? "" : hexAlpha(tl.color, 0.12);
    ch.style.color = tl.color;
    let extra = "";
    if (tl.is_merged) extra = '<span class="chip-badge">merged</span>';
    ch.innerHTML = `<span class="cdot" style="background:${tl.color}"></span><span>${esc(tl.name)}</span>${extra}${tl.is_merged?`<button class="chip-act" data-act="unmerge" data-id="${tl.id}"><i data-lucide="split" style="width:10px;height:10px"></i></button>`:""}<button class="chip-act" data-act="del" data-id="${tl.id}"><i data-lucide="x" style="width:10px;height:10px"></i></button>`;
    ch.addEventListener("click", e => { if (e.target.closest("[data-act]")) return; toggleSelect(tl.id); });
    ch.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async e => {
      e.stopPropagation();
      if (b.dataset.act==="del") { await api(`/api/timelines/${b.dataset.id}`,{method:"DELETE"}); S.selected.delete(b.dataset.id); await loadTimelines(); }
      else if (b.dataset.act==="unmerge") { showLoader("Unmerging..."); await api("/api/unmerge",{method:"POST",body:JSON.stringify({timeline_id:b.dataset.id})}); S.selected.delete(b.dataset.id); hideLoader(); await loadTimelines(); }
    }));
    chipsBar.appendChild(ch);
  });
  lucide.createIcons({nodes:[chipsBar]});
  mergeBtn.disabled = S.selected.size < 2;
}

function toggleSelect(id) { S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); renderChips(); }

// ── Reasoning Panel Logic ───────────────────────────────────────────────────
function showReasoning() {
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
  lucide.createIcons({nodes:[reasoningOverlay]});
}
function hideReasoning() {
  reasoningOverlay.classList.add("hidden");
}
let _reasoningTokenCount = 0;
let _reasoningEvCount = 0;

reasoningToggle.addEventListener("click", () => {
  reasoningBody.classList.toggle("collapsed");
  reasoningToggle.classList.toggle("collapsed");
});

// ── Research (SSE Streaming) ────────────────────────────────────────────────
async function doResearch(query) {
  if (!query || !S.activeId) return;
  showReasoning();
  const color = nextColor();
  const params = new URLSearchParams({session_id: S.activeId, query, color});
  const es = new EventSource(`${API}/api/research/stream?${params}`);
  let cursor = null;

  function appendToken(text) {
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

  function addEventPill(idx, title) {
    _reasoningEvCount = idx;
    reasoningEventCount.textContent = idx + " event" + (idx !== 1 ? "s" : "");
    const pill = document.createElement("span");
    pill.className = "reasoning-ev-pill";
    pill.innerHTML = `<span class="pill-num">${idx}</span>${esc(title)}`;
    reasoningEvents.appendChild(pill);
    reasoningEvents.scrollTop = reasoningEvents.scrollHeight;
  }

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
    reasoningTokens.textContent = _reasoningTokenCount + " tokens";
    reasoningEventCount.textContent = _reasoningEvCount + " events";
    if (cursor) cursor.remove();
    reasoningPulse.classList.add("done");
    reasoningPhase.textContent = "Timeline ready";
    await loadTimelines();
    await loadSessions();
    setTimeout(() => hideReasoning(), 800);
  });

  es.addEventListener("error", e => {
    let msg = "Connection error";
    try { if (e.data) { const d = JSON.parse(e.data); msg = d.message || msg; } } catch {}
    es.close();
    if (cursor) cursor.remove();
    reasoningPulse.classList.add("error");
    reasoningPhase.textContent = "Error: " + msg;
    reasoningOverlay.addEventListener("click", function dismiss(ev) {
      if (ev.target === reasoningOverlay) { hideReasoning(); reasoningOverlay.removeEventListener("click", dismiss); }
    });
  });

  es.addEventListener("done", () => { es.close(); });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    if (cursor) cursor.remove();
    reasoningPulse.classList.add("error");
    reasoningPhase.textContent = "Connection lost";
    reasoningOverlay.addEventListener("click", function dismiss(ev) {
      if (ev.target === reasoningOverlay) { hideReasoning(); reasoningOverlay.removeEventListener("click", dismiss); }
    });
  };
}

// ── Merge ──────────────────────────────────────────────────────────────────
async function doMerge() {
  const ids = [...S.selected]; if (ids.length<2) return;
  showLoader("Merging timelines...");
  try {
    await api("/api/merge", {method:"POST", body:JSON.stringify({session_id:S.activeId, timeline_ids:ids})});
    S.selected.clear(); await loadTimelines(); await loadSessions();
  } catch(e) { alert("Merge failed: "+e.message); }
  finally { hideLoader(); }
}

// ── Zoom ───────────────────────────────────────────────────────────────────
function setZoom(z) {
  S.zoom = Math.max(0.15, Math.min(5, z));
  zoomLevelEl.textContent = Math.round(S.zoom * 100) + "%";
  renderView();
}

function zoomIn() {
  const next = ZOOM_STEPS.find(s => s > S.zoom + 0.01);
  setZoom(next || S.zoom);
}

function zoomOut() {
  const prev = [...ZOOM_STEPS].reverse().find(s => s < S.zoom - 0.01);
  setZoom(prev || S.zoom);
}

function zoomFit() { setZoom(1.0); }

// ── Density ────────────────────────────────────────────────────────────────
function setMinImportance(min) {
  S.minImportance = min;
  densityDropdown.querySelectorAll(".dd-item").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.min) === min);
  });
  const labels = {0:"All", 3:"3+", 5:"5+", 7:"7+", 9:"9+"};
  densityLabel.textContent = labels[min] || "All";
  renderView();
}

// ── Importance Scaling Helpers ─────────────────────────────────────────────
// All importance-based sizing/styling is calculated here.
// imp = 1..10
function impScale(imp) {
  const t = (imp - 1) / 9; // 0..1
  return {
    // Card padding scales from 6px to 14px
    cardPad: Math.round(6 + t * 8),
    // Title font-size: 11px to 16px
    titleSize: Math.round(11 + t * 5),
    // Desc font-size: 10px to 14px
    descSize: Math.round(10 + t * 4),
    // Dot size: 7px to 14px
    dotSize: Math.round(7 + t * 7),
    // Opacity: 0.45 to 1.0
    opacity: +(0.45 + t * 0.55).toFixed(2),
    // Font weight: 500 for low, 600 mid, 700 high
    titleWeight: t < 0.4 ? 500 : (t < 0.7 ? 600 : 700),
    // Glow: only for imp >= 7
    glow: imp >= 7,
    // Bar title size: 11px to 14px
    barTitleSize: Math.round(11 + t * 3),
  };
}

// ── Gap Detection ──────────────────────────────────────────────────────────
// Returns array of {afterIdx, startTs, endTs, label} for gaps to crop
function detectGaps(parsedEvents) {
  if (parsedEvents.length < 2) return [];

  // Calculate all gaps between consecutive events
  const gaps = [];
  for (let i = 0; i < parsedEvents.length - 1; i++) {
    const endTs = parsedEvents[i]._end || parsedEvents[i]._start;
    const nextStart = parsedEvents[i + 1]._start;
    const gapMs = nextStart - endTs;
    if (gapMs > 0) {
      gaps.push({ idx: i, gapMs, startTs: endTs, endTs: nextStart });
    }
  }

  if (gaps.length < 2) return [];

  // Find median gap
  const sorted = [...gaps].sort((a, b) => a.gapMs - b.gapMs);
  const median = sorted[Math.floor(sorted.length / 2)].gapMs;

  // Gaps > 3x median are "large"
  const threshold = median * 3;
  // Also require at least 1 year gap to avoid cropping short timelines
  const minGap = 365.25 * 24 * 3600 * 1000;

  return gaps
    .filter(g => g.gapMs > threshold && g.gapMs > minGap)
    .map(g => {
      const years = g.gapMs / (365.25 * 24 * 3600 * 1000);
      let label;
      if (years >= 1) {
        label = `${Math.round(years)} year${Math.round(years) !== 1 ? "s" : ""} skipped`;
      } else {
        const months = Math.round(years * 12);
        label = `${months} month${months !== 1 ? "s" : ""} skipped`;
      }
      return { afterIdx: g.idx, startTs: g.startTs, endTs: g.endTs, gapMs: g.gapMs, label };
    });
}

// Build a position mapping that compresses gaps into fixed-size breaks
// Returns { posFunc(ts), totalSize, gapBreaks: [{pos, label}] }
function buildGapCroppedMapping(parsedEvents, gaps, pxPerMsNormal, startOffset) {
  if (!gaps.length) {
    const minTs = parsedEvents[0]._start;
    return {
      posFunc: ts => startOffset + (ts - minTs) * pxPerMsNormal,
      totalExtent: (parsedEvents[parsedEvents.length - 1]._end || parsedEvents[parsedEvents.length - 1]._start) - minTs,
      gapBreaks: [],
      effectivePxPerMs: pxPerMsNormal,
    };
  }

  // Build segments between gaps
  const GAP_PX = 40; // fixed pixel size for a gap break
  const minTs = parsedEvents[0]._start;
  const maxTs = Math.max(...parsedEvents.map(e => e._end || e._start));

  // Sort gaps by time
  const sortedGaps = [...gaps].sort((a, b) => a.startTs - b.startTs);

  // Build breakpoints: each segment has a real time range mapped to a condensed pixel range
  const segments = [];
  let prevEnd = minTs;
  let accOffset = 0;

  sortedGaps.forEach(g => {
    // Segment before gap
    const segSpan = g.startTs - prevEnd;
    if (segSpan > 0) {
      segments.push({ fromTs: prevEnd, toTs: g.startTs, pxStart: accOffset, pxSpan: segSpan * pxPerMsNormal });
      accOffset += segSpan * pxPerMsNormal;
    }
    // The gap itself = fixed pixels
    segments.push({ isGap: true, pxStart: accOffset, label: g.label, fromTs: g.startTs, toTs: g.endTs });
    accOffset += GAP_PX;
    prevEnd = g.endTs;
  });

  // Final segment after last gap
  const finalSpan = maxTs - prevEnd;
  if (finalSpan > 0) {
    segments.push({ fromTs: prevEnd, toTs: maxTs, pxStart: accOffset, pxSpan: finalSpan * pxPerMsNormal });
    accOffset += finalSpan * pxPerMsNormal;
  }

  const gapBreaks = segments.filter(s => s.isGap).map(s => ({
    pos: startOffset + s.pxStart + GAP_PX / 2,
    label: s.label,
  }));

  function posFunc(ts) {
    // Find which segment this ts falls into
    for (const seg of segments) {
      if (seg.isGap) {
        if (ts >= seg.fromTs && ts <= seg.toTs) {
          return startOffset + seg.pxStart + GAP_PX / 2;
        }
        continue;
      }
      if (ts >= seg.fromTs && ts <= seg.toTs) {
        const frac = (ts - seg.fromTs) / (seg.toTs - seg.fromTs || 1);
        return startOffset + seg.pxStart + frac * seg.pxSpan;
      }
    }
    // Fallback: if ts is beyond all segments
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.isGap) return startOffset + lastSeg.pxStart + GAP_PX;
    return startOffset + lastSeg.pxStart + lastSeg.pxSpan;
  }

  return { posFunc, totalPx: accOffset, gapBreaks, effectivePxPerMs: pxPerMsNormal };
}

// ── Render View ────────────────────────────────────────────────────────────
function renderView() {
  canvas.innerHTML = "";
  if (!S.timelines.length) { canvas.innerHTML = '<div class="empty-note">Research a topic below to create your first timeline</div>'; return; }
  const allEvts = gatherEvents();
  const filtered = S.minImportance > 0
    ? allEvts.filter(e => (e.importance || 5) >= S.minImportance)
    : allEvts;
  const hiddenCount = allEvts.length - filtered.length;

  if (S.view === "list") renderListView(filtered, hiddenCount);
  else if (S.view === "horizontal") renderHorizontalView(filtered, hiddenCount, allEvts);
  else renderLinearView(filtered, hiddenCount, allEvts);
}

function gatherEvents() {
  const all = [];
  S.timelines.forEach(tl => {
    (tl.events||[]).forEach(e => all.push({...e, _tl:tl}));
  });
  all.sort((a,b) => (a.start_date||"").localeCompare(b.start_date||""));
  return all;
}

// ── LIST VIEW ──────────────────────────────────────────────────────────────

// ── LIST VIEW ──────────────────────────────────────────────────────────────
function renderListView(events, hiddenCount) {
  const wrap = document.createElement("div");
  wrap.className = "list-view";

  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.cssText = "padding:8px 0;font-size:11px";
    note.textContent = `${hiddenCount} lower-importance event${hiddenCount > 1 ? "s" : ""} hidden`;
    wrap.appendChild(note);
  }

  events.forEach((evt, i) => {
    const el = document.createElement("div");
    el.className = "list-ev";
    el.style.animationDelay = `${Math.min(i * 25, 500)}ms`;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const sc = impScale(imp);

    el.innerHTML = `
      <div class="list-dot" style="background:${col};width:${sc.dotSize}px;height:${sc.dotSize}px"></div>
      <div class="list-label" style="opacity:${sc.opacity}">
        <div class="l-date">${fmtDateRange(evt)}</div>
        <div class="l-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
        <div class="l-desc" style="font-size:${sc.descSize}px">${esc(evt.description || "")}</div>
        ${evt.category ? `<div class="l-meta"><span class="l-cat">${esc(evt.category)}</span></div>` : ""}
      </div>
    `;
    el.addEventListener("click", () => openModal(evt));
    wrap.appendChild(el);
  });
  canvas.appendChild(wrap);
}

// ── LINEAR (VERTICAL PROPORTIONAL) VIEW ────────────────────────────────────
// Axis centered in container. Dots on axis, horizontal connectors to labels.
// Left/right alternating with staggered lanes for dense text without clipping.
function renderLinearView(events, hiddenCount, allEvts) {
  if (!events.length) { canvas.innerHTML = '<div class="empty-note">No events to display</div>'; return; }

  const wrap = document.createElement("div");
  wrap.className = "linear-view";

  const parsed = events.map(e => ({
    ...e,
    _start: parseDate(e.start_date),
    _end: e.end_date ? parseDate(e.end_date) : null,
  })).filter(e => e._start);

  if (!parsed.length) { canvas.innerHTML = '<div class="empty-note">No valid dates found</div>'; return; }

  parsed.sort((a, b) => a._start - b._start);

  const minTs = Math.min(...parsed.map(e => e._start));
  const maxTs = Math.max(...parsed.map(e => e._end || e._start));
  const span = maxTs - minTs || 1;

  // Measure available width from the scroll container
  const containerW = canvasWrap.clientWidth - 40; // minus canvas padding
  const AXIS_X = Math.round(containerW * 0.42);   // axis slightly left of center
  const CONN_LEN = 28;        // connector line length
  const TEXT_GAP = 6;          // gap between connector end and text
  const RIGHT_W = Math.min(containerW - AXIS_X - CONN_LEN - TEXT_GAP - 16, 440);
  const LEFT_W = Math.min(AXIS_X - CONN_LEN - TEXT_GAP - 16, 440);
  const MIN_Y_GAP = 44;       // min vertical distance between labels on same side

  // Adaptive density
  const totalYearsRaw = span / (365.25 * 24 * 3600 * 1000);
  const basePxYear = totalYearsRaw > 30 ? 25 : totalYearsRaw > 10 ? 40 : 55;
  const PX_PER_YEAR = basePxYear * S.zoom;
  const basePxPerMs = PX_PER_YEAR / (365.25 * 24 * 3600 * 1000);

  // Gap detection
  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, 30);

  function yPos(ts) { return mapping.posFunc(ts); }

  // Axis
  const axis = document.createElement("div");
  axis.className = "linear-axis";
  axis.style.left = AXIS_X + "px";
  wrap.appendChild(axis);

  // Year labels — placed to the right of the axis, inline
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  const majorStart = Math.floor(minYear / yearStep) * yearStep;
  const minorStep = Math.max(1, Math.floor(yearStep / 2));
  const majorYearSet = new Set();
  for (let y = majorStart; y <= maxYear + yearStep; y += yearStep) majorYearSet.add(y);

  for (let y = majorStart; y <= maxYear + yearStep; y += (minorStep < yearStep ? minorStep : 1)) {
    if (y < minYear || y > maxYear) continue;
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const top = yPos(ts);
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const isMajor = majorYearSet.has(y);
    if (isMajor) {
      const lbl = document.createElement("div");
      lbl.className = "linear-year-label";
      lbl.style.top = top + "px";
      lbl.style.left = (AXIS_X - 52) + "px";
      lbl.style.width = "44px";
      lbl.textContent = y;
      wrap.appendChild(lbl);
      const tick = document.createElement("div");
      tick.className = "linear-year-tick";
      tick.style.top = top + "px";
      tick.style.left = (AXIS_X - 6) + "px";
      wrap.appendChild(tick);
    } else if (minorStep < yearStep) {
      const tick = document.createElement("div");
      tick.className = "linear-year-tick-minor";
      tick.style.top = top + "px";
      tick.style.left = (AXIS_X - 3) + "px";
      wrap.appendChild(tick);
    }
    if (minorStep >= yearStep) y += yearStep - 1;
  }

  // Gap breaks
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break";
    br.style.top = gb.pos + "px";
    br.style.left = (AXIS_X - 6) + "px";
    br.innerHTML = `<div class="gap-break-line">${GAP_BREAK_SVG}${GAP_BREAK_SVG}</div><span class="gap-break-label">${gb.label}</span>`;
    wrap.appendChild(br);
  });

  // Build items with y positions
  const items = parsed.map((e, i) => {
    const y = yPos(e._start);
    const yEnd = e._end ? yPos(e._end) : y;
    const imp = e.importance || 5;
    return { evt: e, y, yEnd, imp, idx: i, side: 0, adjustedY: y };
  });

  items.sort((a, b) => a.y - b.y);

  // Assign sides: alternate
  items.forEach((item, i) => {
    item.side = (i % 2 === 0) ? 1 : -1; // 1 = right, -1 = left
  });

  // De-overlap per side independently — so left and right labels
  // can interleave at staggered Y positions, using more page space
  const rightItems = items.filter(it => it.side === 1).sort((a, b) => a.y - b.y);
  const leftItems = items.filter(it => it.side === -1).sort((a, b) => a.y - b.y);

  function deOverlapSide(arr) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].adjustedY - arr[i - 1].adjustedY < MIN_Y_GAP) {
        arr[i].adjustedY = arr[i - 1].adjustedY + MIN_Y_GAP;
      }
    }
  }
  deOverlapSide(rightItems);
  deOverlapSide(leftItems);

  // Render nodes
  items.forEach((item, i) => {
    const { evt, y, yEnd, imp, side, adjustedY } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);
    const isDuration = evt._end && evt._end !== evt._start;
    const textW = side > 0 ? RIGHT_W : LEFT_W;

    const node = document.createElement("div");
    node.className = "tl-node";
    node.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

    // Dot on axis
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = AXIS_X + "px";
    dot.style.top = y + "px";
    node.appendChild(dot);

    // Duration range bar
    if (isDuration && yEnd > y) {
      const range = document.createElement("div");
      range.className = "tl-range";
      range.style.background = col;
      range.style.top = y + "px";
      range.style.left = (AXIS_X - 1) + "px";
      range.style.height = Math.max(yEnd - y, 4) + "px";
      node.appendChild(range);
    }

    // Connector line (horizontal from axis to text)
    const conn = document.createElement("div");
    conn.className = "tl-conn";
    conn.style.background = col;
    const connTop = adjustedY;
    if (side > 0) {
      conn.style.left = (AXIS_X + 2) + "px";
      conn.style.width = CONN_LEN + "px";
    } else {
      conn.style.left = (AXIS_X - CONN_LEN - 2) + "px";
      conn.style.width = CONN_LEN + "px";
    }
    conn.style.top = connTop + "px";
    node.appendChild(conn);

    // Vertical joiner if label was pushed away from its dot
    if (Math.abs(adjustedY - y) > 2) {
      const joiner = document.createElement("div");
      joiner.className = "tl-conn";
      joiner.style.background = col;
      joiner.style.width = "1px";
      joiner.style.height = Math.abs(adjustedY - y) + "px";
      joiner.style.top = Math.min(y, adjustedY) + "px";
      joiner.style.left = (side > 0 ? AXIS_X + 2 : AXIS_X - 2) + "px";
      node.appendChild(joiner);
    }

    // Text label
    const text = document.createElement("div");
    text.className = "tl-text";
    text.style.top = connTop + "px";
    text.style.transform = "translateY(-50%)";
    text.style.opacity = sc.opacity;
    text.style.width = Math.max(textW, 120) + "px";
    text.style.maxWidth = Math.max(textW, 120) + "px";
    if (side > 0) {
      text.style.left = (AXIS_X + CONN_LEN + TEXT_GAP) + "px";
    } else {
      // Right-align: position so it ends just before the connector
      const leftEdge = AXIS_X - CONN_LEN - TEXT_GAP - Math.max(textW, 120);
      text.style.left = Math.max(4, leftEdge) + "px";
      text.style.textAlign = "right";
    }

    const dateStr = fmtDateRange(evt);
    text.innerHTML = `
      <div class="tl-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
      <div class="tl-sub"><span class="tl-date-inline">${dateStr}</span> ${esc(evt.description || "")}</div>
    `;
    node.appendChild(text);

    node.addEventListener("click", () => openModal(evt));
    wrap.appendChild(node);
  });

  const maxBottom = items.length ? Math.max(...items.map(it => it.adjustedY + 40), ...items.map(it => it.yEnd + 40)) : 400;
  wrap.style.height = Math.max(400, maxBottom + 60) + "px";
  wrap.style.minWidth = (AXIS_X + CONN_LEN + 200) + "px";

  canvas.appendChild(wrap);
}

// ── HORIZONTAL (PROPORTIONAL) VIEW ─────────────────────────────────────────
function renderHorizontalView(events, hiddenCount, allEvts) {
  if (!events.length) { canvas.innerHTML = '<div class="empty-note">No events to display</div>'; return; }

  const wrap = document.createElement("div");
  wrap.className = "horiz-view";

  const parsed = events.map(e => ({
    ...e,
    _start: parseDate(e.start_date),
    _end: e.end_date ? parseDate(e.end_date) : null,
  })).filter(e => e._start);

  if (!parsed.length) { canvas.innerHTML = '<div class="empty-note">No valid dates found</div>'; return; }

  parsed.sort((a, b) => a._start - b._start);

  const minTs = Math.min(...parsed.map(e => e._start));
  const maxTs = Math.max(...parsed.map(e => e._end || e._start));
  const span = maxTs - minTs || 1;

  const PAD_LEFT = 60;
  const PAD_RIGHT = 60;
  const PX_PER_YEAR_H = 150 * S.zoom;
  const basePxPerMs = PX_PER_YEAR_H / (365.25 * 24 * 3600 * 1000);
  const CONN_LEN_V = 30;  // vertical connector length
  const LABEL_H = 40;

  // Gap detection
  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, PAD_LEFT);

  const contentWidth = mapping.totalPx || 800;
  const totalWidth = PAD_LEFT + contentWidth + PAD_RIGHT;

  function xPos(ts) { return mapping.posFunc(ts); }

  // Layout timelines into lanes to avoid overlap
  const timelineIds = [...new Set(parsed.map(e => e._tl.id))];
  const laneMap = {};
  timelineIds.forEach((id, i) => laneMap[id] = i);
  const numLanes = timelineIds.length;

  const AXIS_Y_BASE = 80;
  const LANE_H = 28;
  const totalLaneH = numLanes * LANE_H;
  const AXIS_Y = AXIS_Y_BASE;

  // Axis line
  const axisLine = document.createElement("div");
  axisLine.className = "horiz-axis";
  axisLine.style.top = AXIS_Y + "px";
  axisLine.style.width = totalWidth + "px";
  wrap.appendChild(axisLine);

  // Year labels
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  const majorStart = Math.floor(minYear / yearStep) * yearStep;
  const minorStep = Math.max(1, Math.floor(yearStep / 2));
  const majorYearSet = new Set();
  for (let y = majorStart; y <= maxYear + yearStep; y += yearStep) majorYearSet.add(y);

  for (let y = majorStart; y <= maxYear + yearStep; y += (minorStep < yearStep ? minorStep : 1)) {
    if (y < minYear || y > maxYear) continue;
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const x = xPos(ts);
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const isMajor = majorYearSet.has(y);
    if (isMajor) {
      const lbl = document.createElement("div");
      lbl.className = "horiz-year-label";
      lbl.style.left = x + "px";
      lbl.style.top = (AXIS_Y - 22) + "px";
      lbl.textContent = y;
      wrap.appendChild(lbl);
      const tick = document.createElement("div");
      tick.className = "horiz-year-tick";
      tick.style.left = x + "px";
      tick.style.top = (AXIS_Y - 5) + "px";
      wrap.appendChild(tick);
    } else if (minorStep < yearStep) {
      const tick = document.createElement("div");
      tick.className = "horiz-year-tick-minor";
      tick.style.left = x + "px";
      tick.style.top = (AXIS_Y - 3) + "px";
      wrap.appendChild(tick);
    }
    if (minorStep >= yearStep) y += yearStep - 1;
  }

  // Gap breaks
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break horiz-gap";
    br.style.left = gb.pos + "px";
    br.style.top = (AXIS_Y - 10) + "px";
    br.innerHTML = `<div class="gap-break-line">${GAP_BREAK_SVG}${GAP_BREAK_SVG}</div><span class="gap-break-label">${gb.label}</span>`;
    wrap.appendChild(br);
  });

  // Place events
  const itemsByLane = Array.from({length: numLanes}, () => []);
  const items = parsed.map((e, i) => {
    const x = xPos(e._start);
    const xEnd = e._end ? xPos(e._end) : x;
    const imp = e.importance || 5;
    const lane = laneMap[e._tl.id];
    return { evt: e, x, xEnd, imp, idx: i, lane };
  });

  // Sort by importance desc within each lane for z-index
  items.sort((a, b) => a.x - b.x);

  const DOTS_Y = AXIS_Y;
  const labelRows = []; // track label placements for overlap avoidance

  items.forEach((item, i) => {
    const { evt, x, xEnd, imp, lane } = item;
    const col = evtColor(evt);
    const sc = impScale(imp);
    const isDuration = evt._end && evt._end !== evt._start;

    const node = document.createElement("div");
    node.className = "tl-node";
    node.style.animationDelay = `${Math.min(i * 15, 300)}ms`;

    // Dot
    const dot = document.createElement("div");
    dot.className = "tl-dot" + (sc.glow ? " glow" : "");
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    dot.style.left = x + "px";
    dot.style.top = DOTS_Y + "px";
    node.appendChild(dot);

    // Duration bar
    if (isDuration && xEnd > x) {
      const bar = document.createElement("div");
      bar.className = "tl-range horiz";
      bar.style.background = col;
      bar.style.left = x + "px";
      bar.style.top = DOTS_Y + "px";
      bar.style.width = Math.max(xEnd - x, 4) + "px";
      node.appendChild(bar);
    }

    // Vertical connector
    const conn = document.createElement("div");
    conn.className = "tl-conn vert";
    conn.style.background = col;
    conn.style.left = x + "px";
    conn.style.top = (DOTS_Y + sc.dotSize / 2) + "px";
    conn.style.height = (CONN_LEN_V + lane * LANE_H) + "px";
    conn.style.width = "1px";
    node.appendChild(conn);

    // Label — avoid overlap by checking previous labels at this lane
    const labelY = DOTS_Y + CONN_LEN_V + lane * LANE_H + 4;
    const text = document.createElement("div");
    text.className = "tl-text horiz";
    text.style.left = x + "px";
    text.style.top = labelY + "px";
    text.style.maxWidth = "160px";
    text.style.opacity = sc.opacity;

    const dateStr = fmtDateRange(evt);
    text.innerHTML = `
      <div class="tl-title" style="font-size:${sc.barTitleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
      <div class="tl-date-inline">${dateStr}</div>
    `;
    node.appendChild(text);

    node.addEventListener("click", () => openModal(evt));
    wrap.appendChild(node);
  });

  wrap.style.width = totalWidth + "px";
  wrap.style.height = (AXIS_Y + CONN_LEN_V + numLanes * LANE_H + LABEL_H * 3 + 40) + "px";
  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.cssText = "position:absolute;top:8px;right:8px;font-size:10px";
    note.textContent = `${hiddenCount} event${hiddenCount > 1 ? "s" : ""} hidden`;
    wrap.appendChild(note);
  }

  canvas.appendChild(wrap);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  // BC dates: e.g. "3200 BC" or "-3200" or "3200 BCE"
  const bcMatch = s.match(/^[\-]?(\d+)\s*(?:BC|BCE)$/i);
  if (bcMatch) {
    const year = parseInt(bcMatch[1]);
    // Use a rough timestamp: 1 BC = year 0, 3200 BC = -3199 in proleptic Gregorian
    return -year * 365.25 * 24 * 3600 * 1000;
  }
  // Negative year notation like -3200
  if (/^-\d+$/.test(s)) {
    const year = parseInt(s);
    return year * 365.25 * 24 * 3600 * 1000;
  }
  // Try YYYY only
  if (/^\d{4}$/.test(s)) return new Date(s + "-01-01").getTime();
  // Try YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + "-01").getTime();
  // Natural language centuries: "3rd century BC", "5th century AD"
  const centuryBC = s.match(/^(\d+)(?:st|nd|rd|th)\s+century\s+BC(?:E)?$/i);
  if (centuryBC) return -(parseInt(centuryBC[1]) * 100) * 365.25 * 24 * 3600 * 1000;
  const centuryAD = s.match(/^(\d+)(?:st|nd|rd|th)\s+century(?:\s+AD)?$/i);
  if (centuryAD) return (parseInt(centuryAD[1]) - 1) * 100 * 365.25 * 24 * 3600 * 1000;
  // "circa 1500" or "c. 1500" or "ca. 1500"
  const circa = s.match(/^(?:circa|c\.?|ca\.?)\s*(\d+)/i);
  if (circa) return new Date(circa[1] + "-01-01").getTime();
  // Try full date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function fmtDateRange(evt) {
  const s = fmtDate(evt.start_date);
  const e = evt.end_date ? fmtDate(evt.end_date) : null;
  return e && e !== s ? `${s} – ${e}` : s;
}

function fmtDate(str) {
  if (!str) return "";
  const s = str.trim();
  if (/^-?\d+\s*(?:BC|BCE)$/i.test(s)) return s;
  if (/^-\d+$/.test(s)) return Math.abs(parseInt(s)) + " BC";
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-");
    return new Date(y, m - 1).toLocaleString("default", {month:"short", year:"numeric"});
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString("default", {year:"numeric",month:"short",day:"numeric"});
  }
  return s;
}

function getYearStep(range, zoom) {
  if (range <= 0) return 1;
  const rough = range / (10 * zoom);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find(s => s >= rough) || steps[steps.length - 1];
}

function evtColor(evt) {
  return evt._tl ? evt._tl.color : "#6e7bf2";
}

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(evt) {
  const imp = evt.importance || 5;
  const col = evtColor(evt);
  const dateStr = fmtDateRange(evt);
  modalBg.innerHTML = `
    <div class="modal" style="border-color:${hexAlpha(col,0.3)}">
      <div class="modal-header" style="border-color:${hexAlpha(col,0.2)}">
        <div class="modal-dot" style="background:${col}"></div>
        <div class="modal-meta">
          <div class="modal-date">${dateStr}</div>
          <div class="modal-imp">Importance: ${imp}/10</div>
        </div>
        <button class="modal-close" onclick="closeModal()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <div class="modal-title">${esc(evt.title)}</div>
        ${evt.description ? `<div class="modal-desc">${esc(evt.description)}</div>` : ""}
        ${evt.category ? `<div class="modal-category">${esc(evt.category)}</div>` : ""}
        ${evt.significance ? `<div class="modal-sig"><strong>Significance:</strong> ${esc(evt.significance)}</div>` : ""}
        ${evt.source ? `<div class="modal-source"><strong>Source:</strong> ${esc(evt.source)}</div>` : ""}
        ${evt._tl ? `<div class="modal-tl"><span class="modal-tl-dot" style="background:${evt._tl.color}"></span>${esc(evt._tl.name)}</div>` : ""}
      </div>
    </div>
  `;
  modalBg.classList.remove("hidden");
  lucide.createIcons({nodes:[modalBg]});
}

function closeModal() { modalBg.classList.add("hidden"); }
modalBg.addEventListener("click", e => { if (e.target === modalBg) closeModal(); });

// ── UI Wiring ──────────────────────────────────────────────────────────────
document.getElementById("newResearchBtn").addEventListener("click", () => {
  const q = document.getElementById("researchInput").value.trim();
  if (!q) return;
  if (!S.activeId) { createSession(q); }
  else doResearch(q);
  document.getElementById("researchInput").value = "";
});

document.getElementById("researchInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("newResearchBtn").click();
  }
});

document.getElementById("newThreadBtn").addEventListener("click", () => {
  const q = document.getElementById("landingInput").value.trim();
  if (!q) return;
  createSession(q);
  document.getElementById("landingInput").value = "";
});

document.getElementById("landingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("newThreadBtn").click();
  }
});

document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    S.view = btn.dataset.view;
    document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderView();
  });
});

mergeBtn.addEventListener("click", doMerge);

document.querySelector(".zoom-in").addEventListener("click", zoomIn);
document.querySelector(".zoom-out").addEventListener("click", zoomOut);
document.querySelector(".zoom-fit").addEventListener("click", zoomFit);

document.getElementById("sidebarToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
document.getElementById("sidebarClose").addEventListener("click", () => sidebar.classList.remove("open"));
document.getElementById("homeBtn").addEventListener("click", () => {
  S.activeId = null; S.timelines = []; renderSessions(); showLanding();
});

document.querySelector(".density-btn").addEventListener("click", e => {
  e.stopPropagation();
  densityDropdown.classList.toggle("hidden");
});
densityDropdown.querySelectorAll(".dd-item").forEach(b => {
  b.addEventListener("click", () => {
    setMinImportance(parseInt(b.dataset.min));
    densityDropdown.classList.add("hidden");
  });
});
document.addEventListener("click", () => densityDropdown.classList.add("hidden"));

// ── Init ───────────────────────────────────────────────────────────────────
initTheme();
lucide.createIcons();
loadSessions();
