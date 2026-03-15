/**
 * ChronoWeave -- Route handlers (shared between Express server + Vercel API)
 */

const { v4: uuidv4 } = require("uuid");
const { get, all, run } = require("./db");
const {
  llmCall, llmCallStream, detectIntent, needsWebSearch, webSearch,
  RESEARCH_PROMPT, RESEARCH_PROMPT_WITH_SEARCH, REFINE_PROMPT,
  MERGE_PROMPT, detectProvider,
} = require("./llm");
const { deductCredits, hasCredits, COSTS } = require("./credits");

function sid() {
  return uuidv4().slice(0, 8);
}

// -- Sessions --------------------------------------------------------------

async function listSessions(userId) {
  let rows;
  if (userId) {
    rows = await all("SELECT * FROM sessions WHERE user_id=? ORDER BY updated_at DESC", [userId]);
  } else {
    rows = await all("SELECT * FROM sessions WHERE user_id IS NULL ORDER BY updated_at DESC");
  }
  const out = [];
  for (const r of rows) {
    const cnt = await get("SELECT COUNT(*) as c FROM timelines WHERE session_id=?", [r.id]);
    out.push({ ...r, timeline_count: cnt ? cnt.c : 0 });
  }
  return out;
}

async function createSession(name = "New Session", userId = null) {
  const id = sid();
  await run("INSERT INTO sessions (id, name, user_id) VALUES (?,?,?)", [id, name, userId]);
  return get("SELECT * FROM sessions WHERE id=?", [id]);
}

async function deleteSession(sessionId, userId = null) {
  const session = await get("SELECT * FROM sessions WHERE id=?", [sessionId]);
  if (!session) return { deleted: sessionId };
  if (userId && session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }
  // Delete events first (foreign keys may not cascade with libsql)
  const tls = await all("SELECT id FROM timelines WHERE session_id=?", [sessionId]);
  for (const tl of tls) {
    await run("DELETE FROM events WHERE timeline_id=?", [tl.id]);
  }
  await run("DELETE FROM timelines WHERE session_id=?", [sessionId]);
  await run("DELETE FROM sessions WHERE id=?", [sessionId]);
  return { deleted: sessionId };
}

async function updateSession(sessionId, name, userId = null) {
  const session = await get("SELECT * FROM sessions WHERE id=?", [sessionId]);
  if (session && userId && session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }
  await run("UPDATE sessions SET name=?, updated_at=datetime('now') WHERE id=?", [name, sessionId]);
  return { updated: sessionId };
}

// -- Timelines -------------------------------------------------------------

async function listTimelines(sessionId) {
  const rows = await all("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at", [sessionId]);
  const out = [];
  for (const tl of rows) {
    const evts = await all(
      "SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order",
      [tl.id]
    );
    const o = { ...tl, events: evts };
    if (o.merged_from) o.merged_from = JSON.parse(o.merged_from);
    if (o.merged_event_map) o.merged_event_map = JSON.parse(o.merged_event_map);
    out.push(o);
  }
  return out;
}

async function researchTopic({ session_id, query, name, color }) {
  const sess = await get("SELECT 1 FROM sessions WHERE id=?", [session_id]);
  if (!sess) throw Object.assign(new Error("Session not found"), { status: 404 });

  const events = await llmCall(RESEARCH_PROMPT.replace("{query}", query));

  const tid = sid();
  const tlName = name || query.slice(0, 60);
  await run("INSERT INTO timelines (id,session_id,name,query,color) VALUES (?,?,?,?,?)", [
    tid, session_id, tlName, query, color || "#6e7bf2",
  ]);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    await run(
      "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        sid(), tid,
        e.start_date || "", e.end_date || null, e.date_precision || "day",
        e.title || "", e.description || "", e.category || "",
        i, e.importance || 5, JSON.stringify(e.tags || []),
        tid, tlName, color || "#6e7bf2",
      ]
    );
  }

  await run("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [session_id]);

  const tl = await get("SELECT * FROM timelines WHERE id=?", [tid]);
  const evts = await all("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [tid]);
  return { ...tl, events: evts };
}

async function mergeTimelines({ session_id, timeline_ids, name }) {
  const tlData = [];
  const srcTls = [];

  for (const tid of timeline_ids) {
    const tl = await get("SELECT * FROM timelines WHERE id=?", [tid]);
    if (!tl) throw Object.assign(new Error(`Timeline ${tid} not found`), { status: 404 });
    srcTls.push(tl);
    const evts = await all("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date", [tid]);
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

  await run("INSERT INTO timelines (id,session_id,name,color,is_merged,merged_from) VALUES (?,?,?,?,1,?)", [
    mtid, session_id, mname, "#a78bfa", mfrom,
  ]);

  const emap = [];
  for (let i = 0; i < mergedEvents.length; i++) {
    const e = mergedEvents[i];
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

    await run(
      "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        eid, mtid,
        e.start_date || "", e.end_date || null, e.date_precision || "day",
        e.title || "", e.description || "", e.category || "",
        i, e.importance || 5, JSON.stringify(e.tags || []),
        multi ? JSON.stringify(sids) : sids[0] || mtid,
        srcJson, colJson,
      ]
    );
    emap.push({ merged_event_id: eid, original_event_ids: oids, source_ids: sids });
  }

  await run("UPDATE timelines SET merged_event_map=? WHERE id=?", [JSON.stringify(emap), mtid]);
  await run("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [session_id]);

  const tl = await get("SELECT * FROM timelines WHERE id=?", [mtid]);
  const evts = await all("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [mtid]);
  const out = { ...tl, events: evts };
  if (out.merged_from) out.merged_from = JSON.parse(out.merged_from);
  if (out.merged_event_map) out.merged_event_map = JSON.parse(out.merged_event_map);
  return out;
}

async function unmergeTl(timelineId) {
  const tl = await get("SELECT * FROM timelines WHERE id=?", [timelineId]);
  if (!tl) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!tl.is_merged) throw Object.assign(new Error("Not merged"), { status: 400 });
  await run("DELETE FROM events WHERE timeline_id=?", [timelineId]);
  await run("DELETE FROM timelines WHERE id=?", [timelineId]);
  return {
    unmerged: timelineId,
    original_timelines: tl.merged_from ? JSON.parse(tl.merged_from) : [],
  };
}

async function deleteTimeline(timelineId) {
  await run("DELETE FROM events WHERE timeline_id=?", [timelineId]);
  await run("DELETE FROM timelines WHERE id=?", [timelineId]);
  return { deleted: timelineId };
}

/**
 * Get existing events for the active session (for refine intent).
 */
async function getSessionEvents(sessionId) {
  const timelines = await all("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at DESC", [sessionId]);
  if (!timelines.length) return null;
  const latest = timelines[0];
  const evts = await all("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [latest.id]);
  return { timeline: latest, events: evts };
}

/**
 * Streaming research -- LLM-first approach with credit deduction.
 */
async function researchTopicStream({ session_id, query, name, color, userId }, onEvent) {
  const sess = await get("SELECT 1 FROM sessions WHERE id=?", [session_id]);
  if (!sess) {
    onEvent("error", { message: "Session not found" });
    return;
  }

  const provider = detectProvider();
  const providerLabel =
    provider === "anthropic" ? "Claude" : provider === "openai" ? "GPT" : "Grok";

  // Step 1: Detect intent
  const existing = await getSessionEvents(session_id);
  const hasExisting = existing && existing.events.length > 0;
  const intent = detectIntent(query, hasExisting);
  const operation = intent === "refine" ? "refine" : "research";

  // Credit check + deduction (if user is authenticated)
  let creditResult = null;
  if (userId) {
    if (!(await hasCredits(userId, operation))) {
      onEvent("error", {
        message: `Insufficient credits. ${operation === "research" ? "Research" : "Refine"} costs ${COSTS[operation]} credits.`,
        code: "INSUFFICIENT_CREDITS",
      });
      return;
    }
    creditResult = await deductCredits(userId, operation, session_id);
    onEvent("credits", { cost: creditResult.cost, balance: creditResult.balance });
  }

  onEvent("intent", {
    intent,
    summary: intent === "refine"
      ? `Building on ${existing.events.length} existing events`
      : "Researching new topic",
  });

  // Step 2: Check if web search would help
  const wantsSearch = needsWebSearch(query);
  let searchContext = "";

  if (wantsSearch && process.env.OPENAI_API_KEY) {
    onEvent("status", {
      phase: "searching",
      message: "Searching the web for current information...",
    });

    try {
      const searchResult = await webSearch(query, (progress) => {
        onEvent("search_progress", { message: progress });
      });

      if (searchResult.results) {
        searchContext = searchResult.results;
        onEvent("search_complete", {
          queries_completed: 1,
          queries_total: 1,
        });
      }
    } catch (err) {
      console.error("Web search failed:", err.message);
    }
  }

  // Step 3: Build prompt based on intent
  let prompt;

  if (intent === "refine" && hasExisting) {
    onEvent("status", {
      phase: "reasoning",
      message: `Refining timeline with ${existing.events.length} existing events...`,
    });

    const existingJson = JSON.stringify(
      existing.events.map(e => ({
        start_date: e.start_date,
        end_date: e.end_date,
        date_precision: e.date_precision,
        title: e.title,
        description: e.description,
        importance: e.importance,
        category: e.category,
        tags: e.tags ? JSON.parse(e.tags) : [],
      })),
      null,
      2
    );

    prompt = REFINE_PROMPT
      .replace("{query}", query)
      .replace("{existing_events}", existingJson)
      .replace("{search_context}", searchContext ? `\nAdditional context from web:\n${searchContext}` : "");
  } else if (searchContext) {
    onEvent("status", {
      phase: "reasoning",
      message: `Researching "${query}" with web data...`,
    });
    prompt = RESEARCH_PROMPT_WITH_SEARCH
      .replace("{query}", query)
      .replace("{search_context}", searchContext);
  } else {
    onEvent("status", {
      phase: "reasoning",
      message: `Researching "${query}" — building timeline...`,
    });
    prompt = RESEARCH_PROMPT.replace("{query}", query);
  }

  // Step 4: Stream LLM response
  return await streamAndSave({ session_id, query, name, color, prompt, onEvent, providerLabel });
}

/**
 * Common streaming + save logic for both research and refine paths.
 */
async function streamAndSave({ session_id, query, name, color, prompt, onEvent, providerLabel }) {
  let eventCount = 0;
  let tokenCount = 0;
  let currentTitle = "";
  let inTitle = false;

  let events;
  try {
    events = await llmCallStream(
      prompt,
      (chunk) => {
        tokenCount++;
        onEvent("token", { text: chunk });

        const combined = currentTitle + chunk;
        if (!inTitle && combined.includes('"title"')) {
          inTitle = true;
          currentTitle = "";
        } else if (inTitle) {
          currentTitle += chunk;
          const match = currentTitle.match(/"\s*:\s*"([^"]+)"/);
          if (match) {
            eventCount++;
            onEvent("event_found", {
              index: eventCount,
              title: match[1],
            });
            inTitle = false;
            currentTitle = "";
          }
        }
      },
      6000
    );
  } catch (err) {
    onEvent("error", { message: err.message });
    return;
  }

  onEvent("status", {
    phase: "structuring",
    message: `Organizing ${events.length} events into timeline...`,
  });

  const tid = sid();
  const tlName = name || query.slice(0, 60);
  const tlColor = color || "#6e7bf2";
  await run(
    "INSERT INTO timelines (id,session_id,name,query,color) VALUES (?,?,?,?,?)",
    [tid, session_id, tlName, query, tlColor]
  );

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    await run(
      "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        sid(), tid,
        e.start_date || "", e.end_date || null, e.date_precision || "day",
        e.title || "", e.description || "", e.category || "",
        i, e.importance || 5, JSON.stringify(e.tags || []),
        tid, tlName, tlColor,
      ]
    );
  }

  await run("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [session_id]);

  const tl = await get("SELECT * FROM timelines WHERE id=?", [tid]);
  const evts = await all(
    "SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order",
    [tid]
  );

  onEvent("result", { ...tl, events: evts });
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
