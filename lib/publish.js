/**
 * ChronoWeave -- Publish & Export
 *
 * Publish: Makes a session's timelines viewable at /p/<slug> without login.
 * Export: Returns a YAML representation of a session's timelines.
 */

const { v4: uuidv4 } = require("uuid");
const { get, all, run } = require("./db");

// -- Slug generation ------------------------------------------------------

function generateSlug(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const suffix = uuidv4().slice(0, 6);
  return `${base}-${suffix}`;
}

// -- Publish a session as a public timeline --------------------------------

async function publishTimeline(userId, sessionId, title) {
  // Verify session belongs to user (or user_id is null for legacy sessions)
  const session = await get("SELECT * FROM sessions WHERE id=?", [sessionId]);
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }

  // Get author info
  const user = await get("SELECT name, picture FROM users WHERE id=?", [userId]);
  const authorName = user ? user.name : "Anonymous";
  const authorPicture = user ? user.picture || "" : "";

  // Gather all timelines and events
  const timelines = await all(
    "SELECT * FROM timelines WHERE session_id=? ORDER BY created_at",
    [sessionId]
  );

  const data = [];
  let totalEvents = 0;
  for (const tl of timelines) {
    const events = await all(
      "SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order",
      [tl.id]
    );
    totalEvents += events.length;
    data.push({
      id: tl.id,
      name: tl.name,
      query: tl.query,
      color: tl.color,
      is_merged: tl.is_merged,
      events: events.map((e) => ({
        start_date: e.start_date,
        end_date: e.end_date,
        date_precision: e.date_precision,
        title: e.title,
        description: e.description,
        category: e.category,
        importance: e.importance,
        tags: e.tags ? JSON.parse(e.tags) : [],
        source_timeline_name: e.source_timeline_name,
        source_color: e.source_color,
      })),
    });
  }

  if (!data.length || !data.some((tl) => tl.events.length)) {
    throw Object.assign(new Error("No timeline data to publish"), { status: 400 });
  }

  // Auto-generate a meaningful title from the timeline data
  const autoTitle = generateTitle(data, session.name);
  const finalTitle = title || autoTitle;

  // Auto-generate description from first timeline's first few events
  const desc = data[0].events.slice(0, 3).map(e => e.title).join(", ");

  // Check for existing publication of this session
  const existing = await get(
    "SELECT * FROM published_timelines WHERE user_id=? AND session_id=?",
    [userId, sessionId]
  );

  if (existing) {
    // Update — also regenerate slug from new title so URL stays meaningful
    const newSlug = generateSlug(finalTitle);
    await run(
      "UPDATE published_timelines SET title=?, slug=?, data=?, description=?, author_name=?, author_picture=?, updated_at=datetime('now') WHERE id=?",
      [finalTitle, newSlug, JSON.stringify(data), desc, authorName, authorPicture, existing.id]
    );
    return {
      id: existing.id,
      slug: newSlug,
      title: finalTitle,
      url: `/p/${newSlug}`,
    };
  }

  // Create new
  const id = uuidv4().slice(0, 12);
  const slug = generateSlug(finalTitle);
  await run(
    "INSERT INTO published_timelines (id, user_id, session_id, title, slug, data, description, author_name, author_picture) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, userId, sessionId, finalTitle, slug, JSON.stringify(data), desc, authorName, authorPicture]
  );

  return { id, slug, title: finalTitle, url: `/p/${slug}` };
}

/**
 * Generate a meaningful title from timeline data.
 * Derives from queries, date range, and event themes.
 */
function generateTitle(data, sessionName) {
  // Collect all queries used
  const queries = data.map(tl => tl.query).filter(Boolean);
  const allEvents = data.flatMap(tl => tl.events);

  // Determine date range
  const dates = allEvents.map(e => e.start_date).filter(Boolean).sort();
  const startYear = dates[0] ? dates[0].slice(0, 4) : null;
  const endYear = dates[dates.length - 1] ? dates[dates.length - 1].slice(0, 4) : null;
  const dateRange = startYear && endYear && startYear !== endYear
    ? ` (${startYear}–${endYear})`
    : startYear ? ` (${startYear})` : "";

  // Best title source: first query (usually the main topic)
  if (queries.length) {
    let base = queries[0];
    // Clean up common prefixes that make boring titles
    base = base.replace(/^(history of|timeline of|the history of|the evolution of)\s*/i, '');
    // Capitalize first letter
    base = base.charAt(0).toUpperCase() + base.slice(1);
    // Add date range if the title doesn't already contain years
    if (!/\d{4}/.test(base) && dateRange) {
      base += dateRange;
    }
    // If multiple queries, note the depth
    if (queries.length > 1) {
      const extra = queries.slice(1).map(q => {
        q = q.replace(/^(tell me more about|add more|focus on|what about)\s*/i, '').trim();
        return q;
      }).filter(q => q.length > 3 && q.length < 40);
      if (extra.length === 1) {
        base += ` — ${extra[0].charAt(0).toUpperCase() + extra[0].slice(1)}`;
      }
    }
    return base;
  }

  // Fallback: session name + date range
  if (sessionName && sessionName !== "New Session" && !sessionName.startsWith("Thread")) {
    return sessionName + dateRange;
  }

  // Last resort: derive from top events
  const topEvents = allEvents.filter(e => (e.importance || 0) >= 7).slice(0, 3);
  if (topEvents.length) {
    return topEvents[0].title + dateRange;
  }

  return "Timeline" + dateRange;
}

// -- Get published timeline by slug ----------------------------------------

async function getPublishedTimeline(slug) {
  const pub = await get("SELECT * FROM published_timelines WHERE slug=?", [slug]);
  if (!pub) return null;

  // Increment view count
  await run("UPDATE published_timelines SET view_count = COALESCE(view_count,0) + 1 WHERE id=?", [pub.id]);

  return {
    id: pub.id,
    title: pub.title,
    slug: pub.slug,
    data: JSON.parse(pub.data),
    author_name: pub.author_name || "Anonymous",
    author_picture: pub.author_picture || "",
    like_count: pub.like_count || 0,
    view_count: (pub.view_count || 0) + 1,
    description: pub.description || "",
    created_at: pub.created_at,
    updated_at: pub.updated_at,
  };
}

// -- List user's published timelines ---------------------------------------

async function listPublished(userId) {
  return all(
    "SELECT id, title, slug, like_count, view_count, created_at, updated_at FROM published_timelines WHERE user_id=? ORDER BY updated_at DESC",
    [userId]
  );
}

// -- Discover: public listing of published timelines -----------------------

async function discoverTimelines(limit = 20) {
  const recent = await all(
    `SELECT id, title, slug, description, author_name, author_picture, like_count, view_count, data, created_at
     FROM published_timelines
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );

  const mostLiked = await all(
    `SELECT id, title, slug, description, author_name, author_picture, like_count, view_count, data, created_at
     FROM published_timelines
     WHERE COALESCE(like_count, 0) > 0
     ORDER BY like_count DESC, created_at DESC
     LIMIT ?`,
    [limit]
  );

  // Parse data to extract event count + timeline count for cards
  const enrich = (rows) => rows.map(r => {
    let timelineCount = 0, eventCount = 0;
    try {
      const d = JSON.parse(r.data);
      timelineCount = d.length;
      eventCount = d.reduce((sum, tl) => sum + (tl.events ? tl.events.length : 0), 0);
    } catch {}
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      description: r.description || "",
      author_name: r.author_name || "Anonymous",
      author_picture: r.author_picture || "",
      like_count: r.like_count || 0,
      view_count: r.view_count || 0,
      timeline_count: timelineCount,
      event_count: eventCount,
      created_at: r.created_at,
    };
  });

  return { recent: enrich(recent), most_liked: enrich(mostLiked) };
}

// -- Like / Unlike a published timeline ------------------------------------

async function toggleLike(userId, publishedId) {
  const pub = await get("SELECT id FROM published_timelines WHERE id=?", [publishedId]);
  if (!pub) throw Object.assign(new Error("Not found"), { status: 404 });

  const existing = await get(
    "SELECT id FROM likes WHERE user_id=? AND published_id=?",
    [userId, publishedId]
  );

  if (existing) {
    // Unlike
    await run("DELETE FROM likes WHERE id=?", [existing.id]);
    await run("UPDATE published_timelines SET like_count = MAX(0, COALESCE(like_count,0) - 1) WHERE id=?", [publishedId]);
    const updated = await get("SELECT like_count FROM published_timelines WHERE id=?", [publishedId]);
    return { liked: false, like_count: updated.like_count || 0 };
  } else {
    // Like
    const id = uuidv4().slice(0, 12);
    await run("INSERT INTO likes (id, user_id, published_id) VALUES (?,?,?)", [id, userId, publishedId]);
    await run("UPDATE published_timelines SET like_count = COALESCE(like_count,0) + 1 WHERE id=?", [publishedId]);
    const updated = await get("SELECT like_count FROM published_timelines WHERE id=?", [publishedId]);
    return { liked: true, like_count: updated.like_count || 0 };
  }
}

// -- Check if user has liked a published timeline --------------------------

async function getLikeStatus(userId, publishedId) {
  if (!userId) return { liked: false };
  const existing = await get(
    "SELECT id FROM likes WHERE user_id=? AND published_id=?",
    [userId, publishedId]
  );
  return { liked: !!existing };
}

// -- Unpublish -------------------------------------------------------------

async function unpublishTimeline(userId, publishedId) {
  const pub = await get("SELECT * FROM published_timelines WHERE id=?", [publishedId]);
  if (!pub) throw Object.assign(new Error("Not found"), { status: 404 });
  if (pub.user_id !== userId) throw Object.assign(new Error("Not yours"), { status: 403 });
  await run("DELETE FROM published_timelines WHERE id=?", [publishedId]);
  return { deleted: publishedId };
}

// -- YAML export -----------------------------------------------------------

async function exportYAML(sessionId, userId) {
  const session = await get("SELECT * FROM sessions WHERE id=?", [sessionId]);
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }

  const timelines = await all(
    "SELECT * FROM timelines WHERE session_id=? ORDER BY created_at",
    [sessionId]
  );

  let yaml = `# ChronoWeave Timeline Export\n# Session: ${session.name}\n# Exported: ${new Date().toISOString()}\n\n`;

  for (const tl of timelines) {
    const events = await all(
      "SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order",
      [tl.id]
    );

    yaml += `- timeline:\n`;
    yaml += `    name: "${esc(tl.name)}"\n`;
    yaml += `    query: "${esc(tl.query || "")}"\n`;
    yaml += `    color: "${tl.color}"\n`;
    yaml += `    events:\n`;

    events.forEach((e) => {
      yaml += `      - title: "${esc(e.title)}"\n`;
      yaml += `        start_date: "${e.start_date}"\n`;
      if (e.end_date) yaml += `        end_date: "${e.end_date}"\n`;
      yaml += `        date_precision: "${e.date_precision}"\n`;
      yaml += `        description: "${esc(e.description || "")}"\n`;
      yaml += `        importance: ${e.importance}\n`;
      yaml += `        category: "${esc(e.category || "")}"\n`;
      const tags = e.tags ? JSON.parse(e.tags) : [];
      if (tags.length) yaml += `        tags: [${tags.map((t) => `"${esc(t)}"`).join(", ")}]\n`;
    });
    yaml += "\n";
  }

  return { yaml, filename: `${session.name.replace(/[^a-zA-Z0-9]+/g, "_")}.yaml` };
}

function esc(s) {
  return (s || "").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

module.exports = {
  publishTimeline,
  getPublishedTimeline,
  listPublished,
  discoverTimelines,
  toggleLike,
  getLikeStatus,
  unpublishTimeline,
  exportYAML,
};
