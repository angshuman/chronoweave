/**
 * ChronoWeave -- Route handlers (shared between Express server + Vercel API)
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./db");
const { llmCall, llmCallStream, RESEARCH_PROMPT, MERGE_PROMPT, detectProvider } = require("./llm");

function sid() {
  return uuidv4().slice(0, 8);
}

// -- Sessions --------------------------------------------------------------

function listSessions() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
  return rows.map((r) => {
    const cnt = db.prepare("SELECT COUNT(*) as c FROM timelines WHERE session_id=?").get(r.id);
    return { ...r, timeline_count: cnt.c };
  });
}

function createSession(name = "New Session") {
  const db = getDb();
  const id = sid();
  db.prepare("INSERT INTO sessions (id, name) VALUES (?,?)").run(id, name);
  return db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
}

function deleteSession(sessionId) {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
  return { deleted: sessionId };
}

function updateSession(sessionId, name) {
  const db = getDb();
  db.prepare("UPDATE sessions SET name=?, updated_at=datetime('now') WHERE id=?").run(name, sessionId);
  return { updated: sessionId };
}

// -- Timelines -------------------------------------------------------------

function listTimelines(sessionId) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at").all(sessionId);
  return rows.map((tl) => {
    const evts = db
      .prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order")
      .all(tl.id);
    const out = { ...tl };
    out.events = evts;
    if (out.merged_from) out.merged_from = JSON.parse(out.merged_from);
    if (out.merged_event_map) out.merged_event_map = JSON.parse(out.merged_event_map);
    return out;
  });
}

async function researchTopic({ session_id, query, name, color }) {
  const db = getDb();
  const sess = db.prepare("SELECT 1 FROM sessions WHERE id=?").get(session_id);
  if (!sess) throw Object.assign(new Error("Session not found"), { status: 404 });

  const events = await llmCall(RESEARCH_PROMPT.replace("{query}", query));

  const tid = sid();
  const tlName = name || query.slice(0, 60);
  db.prepare("INSERT INTO timelines (id,session_id,name,query,color) VALUES (?,?,?,?,?)").run(
    tid,
    session_id,
    tlName,
    query,
    color || "#6e7bf2"
  );

  const insert = db.prepare(
    "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  events.forEach((e, i) => {
    insert.run(
      sid(),
      tid,
      e.start_date || "",
      e.end_date || null,
      e.date_precision || "day",
      e.title || "",
      e.description || "",
      e.category || "",
      i,
      e.importance || 5,
      JSON.stringify(e.tags || []),
      tid,
      tlName,
      color || "#6e7bf2"
    );
  });

  db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(session_id);

  const tl = db.prepare("SELECT * FROM timelines WHERE id=?").get(tid);
  const evts = db.prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order").all(tid);
  return { ...tl, events: evts };
}

async function mergeTimelines({ session_id, timeline_ids, name }) {
  const db = getDb();
  const tlData = [];
  const srcTls = [];

  for (const tid of timeline_ids) {
    const tl = db.prepare("SELECT * FROM timelines WHERE id=?").get(tid);
    if (!tl) throw Object.assign(new Error(`Timeline ${tid} not found`), { status: 404 });
    srcTls.push(tl);
    const evts = db.prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date").all(tid);
    const el = evts.map((ed) => ({
      event_id: ed.id,
      timeline_id: tid,
      timeline_name: tl.name,
      timeline_color: tl.color,
      start_date: ed.start_date,
      end_date: ed.end_date,
      date_precision: ed.date_precision,
      title: ed.title,
      description: ed.description,
      importance: ed.importance,
      category: ed.category || "",
      tags: ed.tags ? JSON.parse(ed.tags) : [],
      source_timeline_id: ed.source_timeline_id || tid,
      source_timeline_name: ed.source_timeline_name || tl.name,
      source_color: ed.source_color || tl.color,
    }));
    tlData.push({ timeline_id: tid, timeline_name: tl.name, timeline_color: tl.color, events: el });
  }

  const mergedEvents = await llmCall(
    MERGE_PROMPT.replace("{data}", JSON.stringify(tlData, null, 2)),
    10000
  );

  const mtid = sid();
  const mname = name || "Merged: " + srcTls.map((t) => t.name).join(" + ");
  const mfrom = JSON.stringify(timeline_ids);
  const srcLookup = {};
  tlData.forEach((t) => {
    srcLookup[t.timeline_id] = { name: t.timeline_name, color: t.timeline_color };
  });

  db.prepare("INSERT INTO timelines (id,session_id,name,color,is_merged,merged_from) VALUES (?,?,?,?,1,?)").run(
    mtid,
    session_id,
    mname,
    "#a78bfa",
    mfrom
  );

  const emap = [];
  const insert = db.prepare(
    "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  mergedEvents.forEach((e, i) => {
    const eid = sid();
    const sids = e.source_ids || [];
    const oids = e.original_event_ids || [];
    const multi = sids.length > 1;

    let srcJson, colJson;
    if (multi) {
      srcJson = JSON.stringify(
        sids.map((s) => ({
          id: s,
          name: (srcLookup[s] || {}).name || "?",
          color: (srcLookup[s] || {}).color || "#6e7bf2",
        }))
      );
      colJson = JSON.stringify(sids.map((s) => (srcLookup[s] || {}).color || "#6e7bf2"));
    } else {
      const si = sids[0] ? srcLookup[sids[0]] || { name: "?", color: "#6e7bf2" } : { name: mname, color: "#a78bfa" };
      srcJson = si.name;
      colJson = si.color;
    }

    insert.run(
      eid,
      mtid,
      e.start_date || "",
      e.end_date || null,
      e.date_precision || "day",
      e.title || "",
      e.description || "",
      e.category || "",
      i,
      e.importance || 5,
      JSON.stringify(e.tags || []),
      multi ? JSON.stringify(sids) : sids[0] || mtid,
      srcJson,
      colJson
    );
    emap.push({ merged_event_id: eid, original_event_ids: oids, source_ids: sids });
  });

  db.prepare("UPDATE timelines SET merged_event_map=? WHERE id=?").run(JSON.stringify(emap), mtid);
  db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(session_id);

  const tl = db.prepare("SELECT * FROM timelines WHERE id=?").get(mtid);
  const evts = db.prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order").all(mtid);
  const out = { ...tl, events: evts };
  if (out.merged_from) out.merged_from = JSON.parse(out.merged_from);
  if (out.merged_event_map) out.merged_event_map = JSON.parse(out.merged_event_map);
  return out;
}

function unmergeTl(timelineId) {
  const db = getDb();
  const tl = db.prepare("SELECT * FROM timelines WHERE id=?").get(timelineId);
  if (!tl) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!tl.is_merged) throw Object.assign(new Error("Not merged"), { status: 400 });
  db.prepare("DELETE FROM timelines WHERE id=?").run(timelineId);
  return {
    unmerged: timelineId,
    original_timelines: tl.merged_from ? JSON.parse(tl.merged_from) : [],
  };
}

function deleteTimeline(timelineId) {
  const db = getDb();
  db.prepare("DELETE FROM timelines WHERE id=?").run(timelineId);
  return { deleted: timelineId };
}

/**
 * Streaming research -- calls onEvent(type, data) for SSE.
 */
async function researchTopicStream({ session_id, query, color }, onEvent) {
  const db = getDb();
  const sess = db.prepare("SELECT 1 FROM sessions WHERE id=?").get(session_id);
  if (!sess) throw Object.assign(new Error("Session not found"), { status: 404 });

  onEvent("status", { message: "Researching..." });

  let rawTokens = "";
  const events = await llmCallStream(
    RESEARCH_PROMPT.replace("{query}", query),
    (token) => {
      rawTokens += token;
      onEvent("token", { text: token });
    }
  );

  const tid = sid();
  const tlName = query.slice(0, 60);
  db.prepare("INSERT INTO timelines (id,session_id,name,query,color) VALUES (?,?,?,?,?)").run(
    tid, session_id, tlName, query, color || "#6e7bf2"
  );

  const insert = db.prepare(
    "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  events.forEach((e, i) => {
    insert.run(
      sid(), tid,
      e.start_date || "", e.end_date || null, e.date_precision || "day",
      e.title || "", e.description || "", e.category || "",
      i, e.importance || 5, JSON.stringify(e.tags || []),
      tid, tlName, color || "#6e7bf2"
    );
  });

  db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(session_id);

  const tl = db.prepare("SELECT * FROM timelines WHERE id=?").get(tid);
  const evts = db.prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order").all(tid);
  onEvent("timeline", { ...tl, events: evts });
}

module.exports = {
  listSessions,
  createSession,
  deleteSession,
  updateSession,
  listTimelines,
  researchTopic,
  researchTopicStream,
  mergeTimelines,
  unmergeTl,
  deleteTimeline,
};
