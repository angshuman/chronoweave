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

// ── Research ───────────────────────────────────────────────────────────────
async function doResearch(query) {
  if (!query || !S.activeId) return;
  showLoader("Researching...");
  try {
    await api("/api/research", {method:"POST", body:JSON.stringify({session_id:S.activeId, query, color:nextColor()})});
    await loadTimelines(); await loadSessions();
  } catch(e) { alert("Research failed: "+e.message); }
  finally { hideLoader(); }
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
function renderListView(events, hiddenCount) {
  const wrap = document.createElement("div");
  wrap.className = "list-view";

  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.cssText = "padding:12px 0;font-size:12px";
    note.textContent = `${hiddenCount} lower-importance event${hiddenCount > 1 ? "s" : ""} hidden by filter`;
    wrap.appendChild(note);
  }

  events.forEach((evt, i) => {
    const el = document.createElement("div");
    el.className = "list-ev";
    el.style.animationDelay = `${Math.min(i*30,600)}ms`;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const sc = impScale(imp);

    let durBar = "";
    if (evt.end_date && evt.end_date !== evt.start_date) {
      durBar = `<div class="list-dur" style="background:${col};height:calc(100% - 18px)"></div>`;
    }

    const glowClass = sc.glow ? " imp-glow" : "";

    el.innerHTML = `
      <div class="list-dot" style="background:${col};width:${sc.dotSize}px;height:${sc.dotSize}px"></div>
      ${durBar}
      <div class="list-card${glowClass}" style="padding:${sc.cardPad}px ${sc.cardPad + 4}px;opacity:${sc.opacity}">
        <div class="list-imp" style="background:${col}"></div>
        <div class="list-date">${fmtDateRange(evt)}</div>
        <div class="list-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
        <div class="list-desc" style="font-size:${sc.descSize}px">${esc(evt.description||"")}</div>
        <div class="list-meta">
          ${evt.category ? `<span class="list-cat">${esc(evt.category)}</span>` : ""}
          ${sourceDotsHtml(evt)}
          ${sourceLabel(evt)}
        </div>
      </div>
    `;
    el.querySelector(".list-card").addEventListener("click", () => openModal(evt));
    wrap.appendChild(el);
  });
  canvas.appendChild(wrap);
}

// ── LINEAR (VERTICAL PROPORTIONAL) VIEW ────────────────────────────────────
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

  const AXIS_LEFT = 110;
  const CARD_AREA_LEFT = AXIS_LEFT + 16;
  const PX_PER_YEAR = 70 * S.zoom;
  const totalYears = span / (365.25 * 24 * 3600 * 1000);
  const basePxPerMs = PX_PER_YEAR / (365.25 * 24 * 3600 * 1000);

  // Gap detection
  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, 40);

  const totalHeight = Math.max(800, mapping.totalPx + 120);

  function yPos(ts) { return mapping.posFunc(ts); }

  wrap.style.height = totalHeight + "px";

  // Axis
  const axis = document.createElement("div");
  axis.className = "linear-axis";
  axis.style.left = AXIS_LEFT + "px";
  wrap.appendChild(axis);

  // Year labels
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  for (let y = minYear; y <= maxYear; y += yearStep) {
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const top = yPos(ts);
    // Skip label if it falls inside a gap break region
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const lbl = document.createElement("div");
    lbl.className = "linear-year-label";
    lbl.style.top = top + "px";
    lbl.textContent = y;
    wrap.appendChild(lbl);
    const tick = document.createElement("div");
    tick.className = "linear-year-tick";
    tick.style.top = top + "px";
    wrap.appendChild(tick);
  }

  // Gap break indicators
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break";
    br.style.top = gb.pos + "px";
    br.innerHTML = `<div class="gap-break-line">${GAP_BREAK_SVG}${GAP_BREAK_SVG}</div><span class="gap-break-label">${gb.label}</span>`;
    wrap.appendChild(br);
  });

  // Lane assignment
  const MIN_EVENT_H = 48;
  const LANE_WIDTH = 260;
  const LANE_GAP = 8;

  const items = parsed.map((e, i) => {
    const yStart = yPos(e._start);
    const yEnd = e._end ? Math.max(yPos(e._end), yStart + MIN_EVENT_H) : yStart + MIN_EVENT_H;
    return { evt: e, yStart, yEnd, lane: 0, idx: i };
  });

  items.sort((a, b) => a.yStart - b.yStart || (b.yEnd - b.yStart) - (a.yEnd - a.yStart));

  const laneEnds = [];
  items.forEach(item => {
    let placed = false;
    for (let l = 0; l < laneEnds.length; l++) {
      if (item.yStart >= laneEnds[l] + 4) {
        item.lane = l;
        laneEnds[l] = item.yEnd;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item.lane = laneEnds.length;
      laneEnds.push(item.yEnd);
    }
  });

  const maxLane = laneEnds.length;

  // Cluster hidden events
  if (hiddenCount > 0) {
    const hiddenEvts = allEvts.filter(e => (e.importance || 5) < S.minImportance);
    const clusters = buildClusters(hiddenEvts, parsed, yPos, "vertical");
    clusters.forEach(cl => {
      const pill = document.createElement("div");
      pill.className = "cluster-pill";
      pill.style.top = cl.y + "px";
      pill.style.left = (CARD_AREA_LEFT + maxLane * (LANE_WIDTH + LANE_GAP) + 12) + "px";
      pill.innerHTML = `<span class="cluster-count">${cl.count}</span>${cl.label}`;
      pill.title = cl.titles.join("\n");
      pill.addEventListener("click", () => setMinImportance(0));
      wrap.appendChild(pill);
    });
  }

  // Render events
  items.forEach((item, i) => {
    const { evt, yStart, yEnd, lane } = item;
    const isDuration = evt._end && evt._end !== evt._start;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const sc = impScale(imp);
    const left = CARD_AREA_LEFT + lane * (LANE_WIDTH + LANE_GAP);
    const glowClass = sc.glow ? " imp-glow" : "";

    const el = document.createElement("div");
    el.className = "linear-ev";
    el.style.top = yStart + "px";
    el.style.left = left + "px";
    el.style.width = LANE_WIDTH + "px";
    el.style.animationDelay = `${Math.min(i * 25, 500)}ms`;

    if (isDuration) {
      const h = Math.max(yEnd - yStart, 28);
      el.style.height = h + "px";
      el.innerHTML = `
        <div class="linear-bar${glowClass}" style="background:${hexAlpha(col,0.2)};height:100%;opacity:${sc.opacity}">
          <div class="list-imp" style="background:${col}"></div>
          <span class="linear-bar-title" style="color:${col};font-size:${sc.barTitleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</span>
          <span class="linear-bar-dates">${fmtDateRange(evt)}</span>
          ${sourceDotsSmall(evt)}
        </div>
      `;
      el.querySelector(".linear-bar").addEventListener("click", () => openModal(evt));
    } else {
      el.innerHTML = `
        <div class="linear-point">
          <div class="linear-point-dot" style="background:${col};width:${sc.dotSize}px;height:${sc.dotSize}px"></div>
          <div class="linear-card${glowClass}" style="padding:${sc.cardPad}px ${sc.cardPad + 2}px;opacity:${sc.opacity}">
            <div class="list-imp" style="background:${col}"></div>
            <div class="list-date">${fmtDateRange(evt)}</div>
            <div class="list-title" style="font-size:${sc.titleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
            <div class="list-desc" style="font-size:${sc.descSize}px">${esc(evt.description||"")}</div>
            ${sourceDotsHtml(evt) ? `<div style="margin-top:4px">${sourceDotsHtml(evt)}</div>` : ""}
          </div>
        </div>
      `;
      el.querySelector(".linear-card").addEventListener("click", () => openModal(evt));
    }

    wrap.appendChild(el);
  });

  const maxBottom = Math.max(...items.map(it => it.yEnd)) + 60;
  if (maxBottom > totalHeight) wrap.style.height = maxBottom + "px";
  const maxRight = CARD_AREA_LEFT + maxLane * (LANE_WIDTH + LANE_GAP) + 20;
  wrap.style.minWidth = maxRight + "px";

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
  const totalYears = span / (365.25 * 24 * 3600 * 1000);
  const basePxPerMs = PX_PER_YEAR_H / (365.25 * 24 * 3600 * 1000);

  // Gap detection
  const gaps = detectGaps(parsed);
  const mapping = buildGapCroppedMapping(parsed, gaps, basePxPerMs, PAD_LEFT);

  const contentWidth = mapping.totalPx || Math.max(800, totalYears * PX_PER_YEAR_H);
  const totalWidth = PAD_LEFT + contentWidth + PAD_RIGHT;

  function xPos(ts) { return mapping.posFunc(ts); }

  // Axis dimensions
  const CARD_HEIGHT = 80;
  const LANE_HEIGHT = CARD_HEIGHT + 12;
  const CONNECTOR_GAP = 16;

  // Lane assignment: alternating above/below
  const items = parsed.map((e, idx) => {
    const xStart = xPos(e._start);
    const xEnd = e._end ? Math.max(xPos(e._end), xStart + 100) : xStart + 200;
    return { evt: e, xStart, xEnd, lane: 0, side: "above", idx };
  });
  items.sort((a, b) => a.xStart - b.xStart);

  const aboveLaneEnds = [];
  const belowLaneEnds = [];

  items.forEach(item => {
    const aboveLane = findFreeLane(aboveLaneEnds, item.xStart, item.xEnd);
    const belowLane = findFreeLane(belowLaneEnds, item.xStart, item.xEnd);

    if (aboveLane <= belowLane) {
      item.side = "above";
      item.lane = aboveLane;
      if (aboveLane >= aboveLaneEnds.length) aboveLaneEnds.push(item.xEnd + 8);
      else aboveLaneEnds[aboveLane] = item.xEnd + 8;
    } else {
      item.side = "below";
      item.lane = belowLane;
      if (belowLane >= belowLaneEnds.length) belowLaneEnds.push(item.xEnd + 8);
      else belowLaneEnds[belowLane] = item.xEnd + 8;
    }
  });

  const maxAboveLanes = aboveLaneEnds.length || 1;
  const maxBelowLanes = belowLaneEnds.length || 1;
  const halfHeight = Math.max(maxAboveLanes, maxBelowLanes) * LANE_HEIGHT + CONNECTOR_GAP + 40;
  const totalH = halfHeight * 2 + 40;
  const axisY = halfHeight + 20;

  wrap.style.height = totalH + "px";
  wrap.style.minWidth = totalWidth + "px";

  // Axis line
  const axisEl = document.createElement("div");
  axisEl.className = "horiz-axis";
  axisEl.style.top = axisY + "px";
  axisEl.style.transform = "none";
  wrap.appendChild(axisEl);

  // Year labels
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  const yearStep = getYearStep(maxYear - minYear, S.zoom);
  for (let y = minYear; y <= maxYear; y += yearStep) {
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const inGap = gaps.some(g => ts > g.startTs && ts < g.endTs);
    if (inGap) continue;
    const x = xPos(ts);
    const lbl = document.createElement("div");
    lbl.className = "horiz-year-label";
    lbl.style.left = x + "px";
    lbl.style.top = (axisY + 8) + "px";
    lbl.style.transform = "translateX(-50%)";
    lbl.textContent = y;
    wrap.appendChild(lbl);
    const tick = document.createElement("div");
    tick.className = "horiz-year-tick";
    tick.style.left = x + "px";
    tick.style.top = (axisY - 6) + "px";
    tick.style.transform = "none";
    wrap.appendChild(tick);
  }

  // Gap break indicators (horizontal)
  mapping.gapBreaks.forEach(gb => {
    const br = document.createElement("div");
    br.className = "gap-break-h";
    br.style.left = (gb.pos - 8) + "px";
    br.style.top = (axisY - 24) + "px";
    br.innerHTML = `${GAP_BREAK_SVG}<span class="gap-break-label">${gb.label}</span>`;
    wrap.appendChild(br);
  });

  // Cluster hidden events
  if (hiddenCount > 0) {
    const hiddenEvts = allEvts.filter(e => (e.importance || 5) < S.minImportance);
    const clusters = buildClusters(hiddenEvts, parsed, xPos, "horizontal");
    clusters.forEach(cl => {
      const pill = document.createElement("div");
      pill.className = "cluster-pill";
      pill.style.left = cl.x + "px";
      pill.style.top = (axisY + 28) + "px";
      pill.innerHTML = `<span class="cluster-count">${cl.count}</span>${cl.label}`;
      pill.title = cl.titles.join("\n");
      pill.addEventListener("click", () => setMinImportance(0));
      wrap.appendChild(pill);
    });
  }

  // Render events
  items.forEach((item, i) => {
    const { evt, xStart, xEnd, lane, side } = item;
    const isDuration = evt._end && evt._end !== evt._start;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const sc = impScale(imp);
    const glowClass = sc.glow ? " imp-glow" : "";

    const el = document.createElement("div");
    el.className = `horiz-ev ${side}`;
    el.style.animationDelay = `${Math.min(i * 20, 400)}ms`;

    const cardW = isDuration ? Math.max(xEnd - xStart, 100) : 200;
    el.style.left = xStart + "px";
    el.style.width = cardW + "px";

    const laneOffset = CONNECTOR_GAP + lane * LANE_HEIGHT;

    if (side === "above") {
      el.style.top = (axisY - laneOffset - CARD_HEIGHT) + "px";
    } else {
      el.style.top = (axisY + laneOffset + 4) + "px";
    }

    // Connector line
    const connector = document.createElement("div");
    connector.className = "horiz-connector";
    connector.style.background = hexAlpha(col, 0.3);
    if (side === "above") {
      connector.style.left = "10px";
      connector.style.bottom = "-" + (laneOffset) + "px";
      connector.style.height = laneOffset + "px";
    } else {
      connector.style.left = "10px";
      connector.style.top = "-" + (laneOffset + 4) + "px";
      connector.style.height = (laneOffset + 4) + "px";
    }
    el.appendChild(connector);

    // Dot on axis
    const dot = document.createElement("div");
    dot.className = "horiz-dot";
    dot.style.background = col;
    dot.style.width = sc.dotSize + "px";
    dot.style.height = sc.dotSize + "px";
    if (side === "above") {
      dot.style.top = "auto";
      dot.style.bottom = "-" + (laneOffset + 4) + "px";
      dot.style.left = "10px";
      dot.style.transform = "translate(-50%, 50%)";
    } else {
      dot.style.top = "-" + (laneOffset + 8) + "px";
      dot.style.left = "10px";
      dot.style.transform = "translate(-50%, -50%)";
    }
    el.appendChild(dot);

    // Card content
    if (isDuration) {
      const bar = document.createElement("div");
      bar.className = `horiz-bar${glowClass}`;
      bar.style.background = hexAlpha(col, 0.2);
      bar.style.height = CARD_HEIGHT + "px";
      bar.style.opacity = sc.opacity;
      bar.innerHTML = `
        <div class="list-imp" style="background:${col}"></div>
        <span class="linear-bar-title" style="color:${col};font-size:${sc.barTitleSize}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</span>
        <span class="linear-bar-dates">${fmtDateRange(evt)}</span>
        ${sourceDotsSmall(evt)}
      `;
      bar.addEventListener("click", () => openModal(evt));
      el.appendChild(bar);
    } else {
      const card = document.createElement("div");
      card.className = `horiz-card${glowClass}`;
      card.style.width = "100%";
      card.style.opacity = sc.opacity;
      card.style.padding = `${sc.cardPad}px ${sc.cardPad + 2}px`;
      card.innerHTML = `
        <div class="list-imp" style="background:${col}"></div>
        <div class="list-date">${fmtDateRange(evt)}</div>
        <div class="list-title" style="font-size:${Math.max(sc.titleSize - 1, 11)}px;font-weight:${sc.titleWeight}">${esc(evt.title)}</div>
        <div class="list-desc" style="font-size:${Math.max(sc.descSize - 1, 10)}px;-webkit-line-clamp:2">${esc(evt.description||"")}</div>
      `;
      card.addEventListener("click", () => openModal(evt));
      el.appendChild(card);
    }

    wrap.appendChild(el);
  });

  canvas.appendChild(wrap);
}

// ── Helper: find free lane ─────────────────────────────────────────────────
function findFreeLane(laneEnds, start) {
  for (let l = 0; l < laneEnds.length; l++) {
    if (start >= laneEnds[l]) return l;
  }
  return laneEnds.length;
}

// ── Helper: year step for labels ───────────────────────────────────────────
function getYearStep(yearRange, zoom) {
  const effectiveRange = yearRange / zoom;
  if (effectiveRange > 200) return 50;
  if (effectiveRange > 100) return 20;
  if (effectiveRange > 50) return 10;
  if (effectiveRange > 20) return 5;
  if (effectiveRange > 10) return 2;
  return 1;
}

// ── Helper: build clusters of hidden events ────────────────────────────────
function buildClusters(hiddenEvts, visibleParsed, posFunc, axis) {
  if (!hiddenEvts.length) return [];

  const hiddenParsed = hiddenEvts
    .map(e => ({ ...e, _ts: parseDate(e.start_date) }))
    .filter(e => e._ts)
    .sort((a,b) => a._ts - b._ts);

  if (!hiddenParsed.length) return [];

  const clusters = [];
  let current = { events: [hiddenParsed[0]], ts: hiddenParsed[0]._ts };

  const clusterThreshold = axis === "horizontal" ? 100 / (S.zoom || 1) : 60 / (S.zoom || 1);

  for (let i = 1; i < hiddenParsed.length; i++) {
    const e = hiddenParsed[i];
    const pos = posFunc(e._ts);
    const prevPos = posFunc(current.events[current.events.length - 1]._ts);
    if (Math.abs(pos - prevPos) < clusterThreshold) {
      current.events.push(e);
    } else {
      clusters.push(current);
      current = { events: [e], ts: e._ts };
    }
  }
  clusters.push(current);

  return clusters.map(cl => {
    const midTs = cl.events[Math.floor(cl.events.length / 2)]._ts;
    const pos = posFunc(midTs);
    return {
      count: cl.events.length,
      label: cl.events.length === 1 ? "hidden event" : "hidden events",
      titles: cl.events.map(e => `[${e.importance||5}] ${e.title}`),
      x: axis === "horizontal" ? pos : 0,
      y: axis === "vertical" ? pos : 0,
    };
  });
}

// ── Date Parsing ───────────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return new Date(parseInt(s), 0, 1).getTime();
  if (/^\d{4}-\d{2}$/.test(s)) { const [y,m] = s.split("-"); return new Date(parseInt(y), parseInt(m)-1, 1).getTime(); }
  return new Date(s + "T00:00:00").getTime();
}

function fmtDate(s) {
  if (!s) return "?";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) { const [y,m] = s.split("-"); return `${months[parseInt(m,10)-1]} ${y}`; }
  try {
    const d = new Date(s+"T00:00:00");
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch { return s; }
}

function fmtDateRange(evt) {
  const start = fmtDate(evt.start_date);
  if (!evt.end_date || evt.end_date === evt.start_date) return start;
  const end = fmtDate(evt.end_date);
  return `${start} → ${end}`;
}

// ── Event Helpers ──────────────────────────────────────────────────────────
function evtColor(evt) {
  if (evt.source_color && evt.source_color.startsWith("[")) {
    try { return JSON.parse(evt.source_color)[0] || evt._tl.color; } catch { /* ignore */ }
  }
  return evt.source_color || evt._tl.color;
}

function sourceDotsHtml(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color||"[]");
      return `<span class="list-source-dots">${srcs.map((s,i)=>`<span class="sdot" style="background:${cols[i]?.color||cols[i]||"#6e7bf2"}" title="${esc(s.name||s)}"></span>`).join("")}</span>`;
    } catch { /* ignore */ }
  }
  return "";
}

function sourceDotsSmall(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color||"[]");
      return `<span class="sdots">${srcs.map((s,i)=>`<span class="sdot" style="background:${cols[i]?.color||cols[i]||"#6e7bf2"}"></span>`).join("")}</span>`;
    } catch { /* ignore */ }
  }
  return "";
}

function sourceLabel(evt) {
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      return `<span class="list-source-label">From: ${srcs.map(s=>s.name||s).join(", ")}</span>`;
    } catch { /* ignore */ }
  }
  if (evt._tl.is_merged && evt.source_timeline_name && !evt.source_timeline_name.startsWith("[")) {
    return `<span class="list-source-label">From: ${esc(evt.source_timeline_name)}</span>`;
  }
  return "";
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(evt) {
  _$("#mTitle").textContent = evt.title;
  _$("#mDates").textContent = fmtDateRange(evt);
  _$("#mDesc").textContent = evt.description || "";

  // Importance pips
  const impPips = _$("#mImpPips");
  impPips.innerHTML = "";
  const imp = evt.importance || 5;
  for (let p = 1; p <= 10; p++) {
    const pip = document.createElement("span");
    pip.className = "m-imp-pip" + (p <= imp ? " filled" : "");
    impPips.appendChild(pip);
  }

  const srcEl = _$("#mSources"); srcEl.innerHTML = "";
  if (evt.source_timeline_name && evt.source_timeline_name.startsWith("[")) {
    try {
      const srcs = JSON.parse(evt.source_timeline_name);
      const cols = JSON.parse(evt.source_color||"[]");
      srcs.forEach((s,i) => {
        const it = document.createElement("span"); it.className = "m-src-item";
        it.innerHTML = `<span class="m-src-dot" style="background:${cols[i]?.color||cols[i]||"#6e7bf2"}"></span>${esc(s.name||s)}`;
        srcEl.appendChild(it);
      });
    } catch { /* ignore */ }
  } else if (evt._tl.is_merged && evt.source_timeline_name) {
    const it = document.createElement("span"); it.className = "m-src-item";
    it.innerHTML = `<span class="m-src-dot" style="background:${evt.source_color||"#6e7bf2"}"></span>${esc(evt.source_timeline_name)}`;
    srcEl.appendChild(it);
  }

  const tagEl = _$("#mTags"); tagEl.innerHTML = "";
  try { JSON.parse(evt.tags||"[]").forEach(t => { const sp = document.createElement("span"); sp.className="m-tag"; sp.textContent=t; tagEl.appendChild(sp); }); } catch { /* ignore */ }

  modalBg.classList.remove("hidden");
}

// ── Utils ──────────────────────────────────────────────────────────────────
function esc(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function hexAlpha(hex,a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Events ─────────────────────────────────────────────────────────────────
_$("#newSessionBtn").addEventListener("click", () => createSession());

// Landing input
_$("#landingInput").addEventListener("keydown", e => { if (e.key==="Enter") { const q=e.target.value.trim(); if(q) createSession(q); } });
_$("#landingSubmit").addEventListener("click", () => { const q=_$("#landingInput").value.trim(); if(q) createSession(q); });

// Session query input
_$("#queryInput").addEventListener("keydown", e => { if (e.key==="Enter") { const q=e.target.value.trim(); if(q){e.target.value="";doResearch(q);} } });
_$("#querySubmit").addEventListener("click", () => { const q=_$("#queryInput").value.trim(); if(q){_$("#queryInput").value="";doResearch(q);} });

mergeBtn.addEventListener("click", doMerge);
_$("#mobileToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
_$("#mClose").addEventListener("click", () => modalBg.classList.add("hidden"));
modalBg.addEventListener("click", e => { if (e.target===modalBg) modalBg.classList.add("hidden"); });

// View switch
viewSwitch.querySelectorAll(".vs-btn").forEach(b => b.addEventListener("click", () => {
  viewSwitch.querySelectorAll(".vs-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  S.view = b.dataset.view;
  renderView();
}));

// Zoom controls
_$("#zoomIn").addEventListener("click", zoomIn);
_$("#zoomOut").addEventListener("click", zoomOut);
_$("#zoomFit").addEventListener("click", zoomFit);

// Mouse wheel zoom on canvas
canvasWrap.addEventListener("wheel", e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }
}, { passive: false });

// Density dropdown
_$("#densityBtn").addEventListener("click", e => {
  e.stopPropagation();
  densityDropdown.classList.toggle("hidden");
});
densityDropdown.querySelectorAll(".dd-item").forEach(b => b.addEventListener("click", () => {
  setMinImportance(parseInt(b.dataset.min));
  densityDropdown.classList.add("hidden");
}));
document.addEventListener("click", () => densityDropdown.classList.add("hidden"));

// ── Init ───────────────────────────────────────────────────────────────────
initTheme();
lucide.createIcons();
loadSessions();
