/**
 * ChronoWeave -- Route handlers (shared between Express server + Vercel API)
 */

const { v4: uuidv4 } = require("uuid");
const { get, all, run } = require("./db");
const {
  llmCall, llmCallStream, detectIntent, needsWebSearch, webSearch,
  generateSuggestions, generateSessionTitle,
  RESEARCH_PROMPT, RESEARCH_PROMPT_WITH_SEARCH, REFINE_PROMPT,
  MERGE_PROMPT, QUESTION_PROMPT, EDIT_PROMPT, detectProvider,
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
 * Get ALL existing events across all timelines in the session (for refine intent).
 * Returns events from every timeline so the LLM has full context and isn't
 * constrained to the date range of just the latest timeline.
 */
async function getSessionEvents(sessionId) {
  const timelines = await all("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at DESC", [sessionId]);
  if (!timelines.length) return null;
  const latest = timelines[0];
  // Gather events from ALL timelines in the session
  const allEvts = [];
  for (const tl of timelines) {
    const evts = await all("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [tl.id]);
    allEvts.push(...evts);
  }
  // Sort chronologically and deduplicate by title
  allEvts.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const seen = new Set();
  const deduped = allEvts.filter(e => {
    if (seen.has(e.title)) return false;
    seen.add(e.title);
    return true;
  });
  return { timeline: latest, events: deduped };
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

  // -- Handle client-side intents (navigate, display) without any LLM call --
  if (intent === "navigate") {
    const params = parseNavigateParams(query);
    onEvent("intent", { intent: "navigate", summary: "Adjusting timeline view" });
    onEvent("client_action", { action: "navigate", ...params });
    onEvent("status", { phase: "done", message: "Navigation applied" });
    return;
  }

  if (intent === "display") {
    const params = parseDisplayParams(query);
    onEvent("intent", { intent: "display", summary: "Changing display settings" });
    onEvent("client_action", { action: "display", ...params });
    onEvent("status", { phase: "done", message: "Display updated" });
    return;
  }

  // -- Handle question intent with targeted LLM call (no new timeline) --
  if (intent === "question" && hasExisting) {
    const operation = "refine"; // questions cost same as refine
    if (userId) {
      if (!(await hasCredits(userId, operation))) {
        onEvent("error", {
          message: `Insufficient credits. Questions cost ${COSTS[operation]} credits.`,
          code: "INSUFFICIENT_CREDITS",
        });
        return;
      }
      const creditResult = await deductCredits(userId, operation, session_id);
      onEvent("credits", { cost: creditResult.cost, balance: creditResult.balance });
    }

    onEvent("intent", { intent: "question", summary: `Answering question based on ${existing.events.length} events` });
    onEvent("status", { phase: "reasoning", message: "Thinking about your question..." });

    const existingCompact = existing.events.map(e =>
      `- [${e.start_date}${e.end_date ? ' → ' + e.end_date : ''}] ${e.title} (imp:${e.importance}) ${e.description || ""}`
    ).join('\n');

    const prompt = QUESTION_PROMPT
      .replace("{query}", query)
      .replace("{existing_events}", existingCompact);

    try {
      let answerText = "";
      const result = await llmCallStream(prompt, (chunk) => {
        answerText += chunk;
        onEvent("token", { text: chunk });
      }, 2000);
      const answer = result.answer || answerText;
      onEvent("status", { phase: "done", message: "Question answered" });
      onEvent("answer", { text: answer });
    } catch (err) {
      console.error("Question LLM error:", err.message);
      onEvent("error", { message: "Failed to answer question. Please try again." });
    }
    return;
  }

  // -- Handle edit intent with targeted LLM call --
  if (intent === "edit" && hasExisting) {
    const operation = "refine";
    if (userId) {
      if (!(await hasCredits(userId, operation))) {
        onEvent("error", {
          message: `Insufficient credits. Edit costs ${COSTS[operation]} credits.`,
          code: "INSUFFICIENT_CREDITS",
        });
        return;
      }
      const creditResult = await deductCredits(userId, operation, session_id);
      onEvent("credits", { cost: creditResult.cost, balance: creditResult.balance });
    }

    onEvent("intent", { intent: "edit", summary: `Editing timeline with ${existing.events.length} events` });
    onEvent("status", { phase: "reasoning", message: "Processing your edit request..." });

    const existingCompact = existing.events.map(e =>
      `- [${e.start_date}${e.end_date ? ' → ' + e.end_date : ''}] ${e.title} (imp:${e.importance})`
    ).join('\n');

    const prompt = EDIT_PROMPT
      .replace("{query}", query)
      .replace("{existing_events}", existingCompact);

    try {
      const result = await llmCallStream(prompt, (chunk) => {
        onEvent("token", { text: chunk });
      }, 4000);

      if (result.action === "remove" && Array.isArray(result.remove_titles)) {
        const titles = result.remove_titles;
        // Remove from all timelines in the session
        const timelines = await all("SELECT id FROM timelines WHERE session_id=?", [session_id]);
        let removed = 0;
        for (const tl of timelines) {
          for (const title of titles) {
            const res = await run("DELETE FROM events WHERE timeline_id=? AND title=?", [tl.id, title]);
            if (res.changes) removed += res.changes;
          }
        }
        onEvent("status", { phase: "done", message: `Removed ${removed} event${removed !== 1 ? "s" : ""}` });
        onEvent("result", { edited: true, removed });
      } else if (result.action === "update_importance" && Array.isArray(result.updates)) {
        const timelines = await all("SELECT id FROM timelines WHERE session_id=?", [session_id]);
        let updated = 0;
        for (const tl of timelines) {
          for (const upd of result.updates) {
            const res = await run("UPDATE events SET importance=? WHERE timeline_id=? AND title=?", [upd.importance, tl.id, upd.title]);
            if (res.changes) updated += res.changes;
          }
        }
        onEvent("status", { phase: "done", message: `Updated ${updated} event${updated !== 1 ? "s" : ""}` });
        onEvent("result", { edited: true, updated });
      } else {
        onEvent("error", { message: "Could not understand the edit instruction. Try rephrasing." });
      }
    } catch (err) {
      console.error("Edit LLM error:", err.message);
      onEvent("error", { message: "Failed to process edit. Please try again." });
    }
    await run("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [session_id]);
    return;
  }

  // -- Research and Refine intents (existing behavior) --
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

    // Send compact summaries to save tokens and prevent duplication
    const existingCompact = existing.events.map(e =>
      `- [${e.start_date}${e.end_date ? ' → ' + e.end_date : ''}] ${e.title} (imp:${e.importance})`
    ).join('\n');

    prompt = REFINE_PROMPT
      .replace("{query}", query)
      .replace("{existing_events}", existingCompact)
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
      10000
    );
  } catch (err) {
    // Surface meaningful error messages instead of raw API errors
    let msg = err.message || "Unknown error";
    let code = null;
    if (/insufficient.*(credit|quota|balance)/i.test(msg) || /402|429/.test(String(err.status || err.statusCode))) {
      msg = "API rate limit or quota exceeded. Please try again in a moment.";
      code = "RATE_LIMIT";
    } else if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(msg)) {
      msg = "The AI service timed out. Please try again.";
      code = "TIMEOUT";
    } else if (/api.key|auth|401|403/i.test(msg)) {
      msg = "AI service authentication error. Check server configuration.";
      code = "AUTH_ERROR";
    } else if (/parse|JSON|Unexpected token/i.test(msg)) {
      msg = "Failed to parse AI response. Please try again.";
      code = "PARSE_ERROR";
    }
    console.error("LLM stream error:", err.message);
    onEvent("error", { message: msg, code });
    return;
  }

  // Handle remove-only responses from refine (e.g. "remove minor events")
  if (!Array.isArray(events) && events.remove_titles) {
    const titles = events.remove_titles;
    const latest = await all(
      "SELECT t.id FROM timelines t WHERE t.session_id=? ORDER BY t.created_at DESC LIMIT 1",
      [session_id]
    );
    if (latest.length) {
      for (const title of titles) {
        await run("DELETE FROM events WHERE timeline_id=? AND title=?", [latest[0].id, title]);
      }
    }
    onEvent("status", { phase: "done", message: `Removed ${titles.length} events` });
    await run("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [session_id]);
    onEvent("result", { removed: titles.length });
    return;
  }

  if (!Array.isArray(events)) {
    onEvent("error", { message: "Unexpected response format. Please try again." });
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

  // Run suggestions and title update in parallel (both lightweight LLM calls).
  // Both complete before the stream closes so clients receive the events.
  const eventTitles = evts.map(e => e.title);

  const suggestionsPromise = generateSuggestions(query, eventTitles)
    .then(suggestions => {
      if (suggestions.length > 0) onEvent("suggestions", { suggestions });
    })
    .catch(err => console.error("Suggestions error:", err.message));

  // Update session title holistically on follow-ups (2+ timelines).
  // For the very first timeline, the initial query is the title — skip.
  const allTimelines = await all("SELECT id FROM timelines WHERE session_id=?", [session_id]);
  let titlePromise = Promise.resolve();
  if (allTimelines.length > 1) {
    const allSessionEvents = [];
    for (const t of allTimelines) {
      const te = await all("SELECT category FROM events WHERE timeline_id=?", [t.id]);
      allSessionEvents.push(...te);
    }
    const categories = [...new Set(allSessionEvents.map(e => e.category).filter(Boolean))];
    const sess = await get("SELECT name FROM sessions WHERE id=?", [session_id]);
    const currentTitle = sess ? sess.name : query;

    titlePromise = generateSessionTitle(currentTitle, query, categories)
      .then(async (newTitle) => {
        if (newTitle && newTitle !== currentTitle) {
          await run("UPDATE sessions SET name=?, updated_at=datetime('now') WHERE id=?", [newTitle, session_id]);
          onEvent("title_updated", { title: newTitle });
        }
      })
      .catch(err => console.error("Title update error:", err.message));
  }

  await Promise.all([suggestionsPromise, titlePromise]);
}

// -- Navigate / Display param parsers (client-side intents) -------------------

/**
 * Extract navigation params from user query (zoom, focus on time period).
 * Returns { zoomTo, startYear, endYear } where applicable.
 */
function parseNavigateParams(query) {
  const q = query.toLowerCase();
  const params = {};

  // Extract year ranges: "1960-1970", "1960 to 1970", "1960s"
  const rangeMatch = q.match(/(\d{4})\s*[-–—to]+\s*(\d{4})/);
  if (rangeMatch) {
    params.startYear = parseInt(rangeMatch[1]);
    params.endYear = parseInt(rangeMatch[2]);
  } else {
    const decadeMatch = q.match(/(\d{3})0s/);
    if (decadeMatch) {
      params.startYear = parseInt(decadeMatch[1] + "0");
      params.endYear = params.startYear + 9;
    } else {
      const yearMatch = q.match(/\b(\d{4})\b/);
      if (yearMatch) {
        params.startYear = parseInt(yearMatch[1]);
        params.endYear = params.startYear;
      }
    }
  }

  // Detect relative modifiers
  if (/\b(early|beginning)\b/.test(q)) params.position = "early";
  if (/\b(mid|middle)\b/.test(q)) params.position = "mid";
  if (/\b(late|end)\b/.test(q)) params.position = "late";

  // Detect zoom in/out
  if (/zoom\s+in/i.test(q)) params.zoomDirection = "in";
  if (/zoom\s+out/i.test(q)) params.zoomDirection = "out";

  return params;
}

/**
 * Extract display params from user query (view mode, importance filter).
 * Returns { view, minImportance, zoomDirection } where applicable.
 */
function parseDisplayParams(query) {
  const q = query.toLowerCase();
  const params = {};

  // View mode switch
  const viewMatch = q.match(/\b(horizontal|vertical|linear|list)\b/);
  if (viewMatch) {
    const v = viewMatch[1];
    params.view = v === "vertical" ? "linear" : v;
  }

  // Importance filter: "importance 7+", "show only high", etc.
  const impMatch = q.match(/importance\s*(\d+)/);
  if (impMatch) {
    params.minImportance = parseInt(impMatch[1]);
  } else if (/\b(high|important|major)\b/.test(q)) {
    params.minImportance = 7;
  } else if (/\bhide\s+(minor|low|unimportant)\b/.test(q)) {
    params.minImportance = 5;
  }

  // Zoom in/out
  if (/\b(zoom\s+in|increase\s+zoom|increase\s+size)\b/.test(q)) params.zoomDirection = "in";
  if (/\b(zoom\s+out|decrease\s+zoom|decrease\s+size)\b/.test(q)) params.zoomDirection = "out";

  return params;
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
