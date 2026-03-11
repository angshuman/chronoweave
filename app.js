/* ChronoWeave — Timeline Research App */

const API = "__PORT_8000__".startsWith("__") ? "http://localhost:8000" : "__PORT_8000__";

// ── State ──────────────────────────────────────────────────────────────────
const S = {
  sessions: [],
  activeId: null,
  timelines: [],
  selected: new Set(),
  view: "linear",
};

const COLORS = ["#6e7bf2","#f87171","#4ade80","#fb923c","#a78bfa","#22d3ee","#e8af34","#f472b6","#38bdf8","#a3e635"];
let colorIdx = 0;
function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

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

// ── API Helper ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { headers: {"Content-Type":"application/json",...opts.headers}, ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({detail:r.statusText})); throw new Error(e.detail||"Error"); }
  return r.json();
}
function showLoader(t) { loaderText.textContent = t; loaderBg.classList.remove("hidden"); }
function hideLoader() { loaderBg.classList.add("hidden"); }

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

// ── Render View ────────────────────────────────────────────────────────────
function renderView() {
  canvas.innerHTML = "";
  if (!S.timelines.length) { canvas.innerHTML = '<div class="empty-note">Research a topic below to create your first timeline</div>'; return; }
  const allEvts = gatherEvents();
  if (S.view === "list") renderListView(allEvts);
  else renderLinearView(allEvts);
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
function renderListView(events) {
  const wrap = document.createElement("div");
  wrap.className = "list-view";
  events.forEach((evt,i) => {
    const el = document.createElement("div");
    el.className = "list-ev";
    el.style.animationDelay = `${Math.min(i*30,600)}ms`;
    const col = evtColor(evt);
    const imp = evt.importance||5;
    const impOp = 0.2 + (imp/10)*0.8;

    // Duration bar in the gutter for duration events
    let durBar = "";
    if (evt.end_date && evt.end_date !== evt.start_date) {
      durBar = `<div class="list-dur" style="background:${col};height:calc(100% - 18px)"></div>`;
    }

    el.innerHTML = `
      <div class="list-dot" style="background:${col}"></div>
      ${durBar}
      <div class="list-card">
        <div class="list-imp" style="background:${col};opacity:${impOp}"></div>
        <div class="list-date">${fmtDateRange(evt)}</div>
        <div class="list-title">${esc(evt.title)}</div>
        <div class="list-desc">${esc(evt.description||"")}</div>
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

// ── LINEAR (PROPORTIONAL) VIEW ─────────────────────────────────────────────
function renderLinearView(events) {
  if (!events.length) { canvas.innerHTML = '<div class="empty-note">No events to display</div>'; return; }

  const wrap = document.createElement("div");
  wrap.className = "linear-view";

  // Parse dates to timestamps
  const parsed = events.map(e => ({
    ...e,
    _start: parseDate(e.start_date),
    _end: e.end_date ? parseDate(e.end_date) : null,
  })).filter(e => e._start);

  if (!parsed.length) { canvas.innerHTML = '<div class="empty-note">No valid dates found</div>'; return; }

  const minTs = Math.min(...parsed.map(e => e._start));
  const maxTs = Math.max(...parsed.map(e => e._end || e._start));
  const span = maxTs - minTs || 1;

  // Scale: pixels per millisecond — target ~60px per year minimum, up to 1500px total
  const AXIS_LEFT = 110; // px left for year labels
  const CARD_AREA_LEFT = AXIS_LEFT + 16; // after axis line + gap
  const MIN_HEIGHT = 800;
  const PX_PER_YEAR = 70;
  const totalYears = span / (365.25*24*3600*1000);
  const totalHeight = Math.max(MIN_HEIGHT, totalYears * PX_PER_YEAR + 120);
  const pxPerMs = (totalHeight - 80) / span; // leave 40px top/bottom padding

  function yPos(ts) { return 40 + (ts - minTs) * pxPerMs; }

  wrap.style.height = totalHeight + "px";

  // Axis line
  const axis = document.createElement("div");
  axis.className = "linear-axis";
  axis.style.left = AXIS_LEFT + "px";
  wrap.appendChild(axis);

  // Year labels + ticks
  const minYear = new Date(minTs).getFullYear();
  const maxYear = new Date(maxTs).getFullYear();
  for (let y = minYear; y <= maxYear; y++) {
    const ts = new Date(y, 0, 1).getTime();
    if (ts < minTs || ts > maxTs) continue;
    const top = yPos(ts);

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

  // ── Lane assignment for overlapping events ──────────────────────────────
  // Each event occupies vertical space [yStart, yEnd].
  // Point events get a min height of 48px.
  // We assign lanes so that overlapping events sit side-by-side.
  const MIN_EVENT_H = 48;
  const LANE_WIDTH = 260;
  const LANE_GAP = 8;

  const items = parsed.map((e, i) => {
    const yStart = yPos(e._start);
    const yEnd = e._end ? Math.max(yPos(e._end), yStart + MIN_EVENT_H) : yStart + MIN_EVENT_H;
    return { evt: e, yStart, yEnd, lane: 0, idx: i };
  });

  // Sort by start position, then by duration (longer first for better packing)
  items.sort((a, b) => a.yStart - b.yStart || (b.yEnd - b.yStart) - (a.yEnd - a.yStart));

  // Greedy lane assignment
  const laneEnds = []; // laneEnds[l] = the y position where lane l becomes free
  items.forEach(item => {
    let placed = false;
    for (let l = 0; l < laneEnds.length; l++) {
      if (item.yStart >= laneEnds[l] + 4) { // 4px gap between events in same lane
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

  // Render events
  items.forEach((item, i) => {
    const { evt, yStart, yEnd, lane } = item;
    const isDuration = evt._end && evt._end !== evt._start;
    const col = evtColor(evt);
    const imp = evt.importance || 5;
    const impOp = 0.2 + (imp/10) * 0.8;
    const left = CARD_AREA_LEFT + lane * (LANE_WIDTH + LANE_GAP);

    const el = document.createElement("div");
    el.className = "linear-ev";
    el.style.top = yStart + "px";
    el.style.left = left + "px";
    el.style.width = LANE_WIDTH + "px";
    el.style.animationDelay = `${Math.min(i * 25, 500)}ms`;

    if (isDuration) {
      // Bar style for duration events
      const h = Math.max(yEnd - yStart, 28);
      el.style.height = h + "px";
      el.innerHTML = `
        <div class="linear-bar" style="background:${hexAlpha(col,0.2)};height:100%">
          <div class="list-imp" style="background:${col};opacity:${impOp}"></div>
          <span class="linear-bar-title" style="color:${col}">${esc(evt.title)}</span>
          <span class="linear-bar-dates">${fmtDateRange(evt)}</span>
          ${sourceDotsSmall(evt)}
        </div>
      `;
      el.querySelector(".linear-bar").addEventListener("click", () => openModal(evt));
    } else {
      // Card style for point events
      el.innerHTML = `
        <div class="linear-point">
          <div class="linear-point-dot" style="background:${col}"></div>
          <div class="linear-card">
            <div class="list-imp" style="background:${col};opacity:${impOp}"></div>
            <div class="list-date">${fmtDateRange(evt)}</div>
            <div class="list-title">${esc(evt.title)}</div>
            <div class="list-desc">${esc(evt.description||"")}</div>
            ${sourceDotsHtml(evt) ? `<div style="margin-top:4px">${sourceDotsHtml(evt)}</div>` : ""}
          </div>
        </div>
      `;
      el.querySelector(".linear-card").addEventListener("click", () => openModal(evt));
    }

    wrap.appendChild(el);
  });

  // Extend wrap height if events overflow
  const maxBottom = Math.max(...items.map(it => it.yEnd)) + 60;
  if (maxBottom > totalHeight) wrap.style.height = maxBottom + "px";

  // Set min-width so horizontal scroll works
  const maxRight = CARD_AREA_LEFT + maxLane * (LANE_WIDTH + LANE_GAP) + 20;
  wrap.style.minWidth = maxRight + "px";

  canvas.appendChild(wrap);
}

// ── Date Parsing ───────────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  // YYYY
  if (/^\d{4}$/.test(s)) return new Date(parseInt(s), 0, 1).getTime();
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) { const [y,m] = s.split("-"); return new Date(parseInt(y), parseInt(m)-1, 1).getTime(); }
  // YYYY-MM-DD
  return new Date(s + "T00:00:00").getTime();
}

function fmtDate(s, prec) {
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
  const start = fmtDate(evt.start_date, evt.date_precision);
  if (!evt.end_date || evt.end_date === evt.start_date) return start;
  const end = fmtDate(evt.end_date, evt.date_precision);
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

// ── Init ───────────────────────────────────────────────────────────────────
lucide.createIcons();
loadSessions();
