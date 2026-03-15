/**
 * ChronoWeave -- Publish & Export
 *
 * Publish: Makes a session's timelines viewable at /p/<slug> without login.
 * Export: Returns a YAML representation of a session's timelines.
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./db");

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

function publishTimeline(userId, sessionId, title) {
  const db = getDb();

  // Verify session belongs to user (or user_id is null for legacy sessions)
  const session = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId);
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }

  // Gather all timelines and events
  const timelines = db
    .prepare("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at")
    .all(sessionId);

  const data = timelines.map((tl) => {
    const events = db
      .prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order")
      .all(tl.id);
    return {
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
    };
  });

  if (!data.length || !data.some((tl) => tl.events.length)) {
    throw Object.assign(new Error("No timeline data to publish"), { status: 400 });
  }

  // Check for existing publication of this session
  const existing = db
    .prepare("SELECT * FROM published_timelines WHERE user_id=? AND session_id=?")
    .get(userId, sessionId);

  if (existing) {
    // Update
    db.prepare(
      "UPDATE published_timelines SET title=?, data=?, updated_at=datetime('now') WHERE id=?"
    ).run(title || existing.title, JSON.stringify(data), existing.id);
    return {
      id: existing.id,
      slug: existing.slug,
      title: title || existing.title,
      url: `/p/${existing.slug}`,
    };
  }

  // Create new
  const id = uuidv4().slice(0, 12);
  const slug = generateSlug(title || session.name);
  db.prepare(
    "INSERT INTO published_timelines (id, user_id, session_id, title, slug, data) VALUES (?,?,?,?,?,?)"
  ).run(id, userId, sessionId, title || session.name, slug, JSON.stringify(data));

  return { id, slug, title: title || session.name, url: `/p/${slug}` };
}

// -- Get published timeline by slug ----------------------------------------

function getPublishedTimeline(slug) {
  const db = getDb();
  const pub = db.prepare("SELECT * FROM published_timelines WHERE slug=?").get(slug);
  if (!pub) return null;
  return {
    id: pub.id,
    title: pub.title,
    slug: pub.slug,
    data: JSON.parse(pub.data),
    created_at: pub.created_at,
    updated_at: pub.updated_at,
  };
}

// -- List user's published timelines ---------------------------------------

function listPublished(userId) {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, title, slug, created_at, updated_at FROM published_timelines WHERE user_id=? ORDER BY updated_at DESC"
    )
    .all(userId);
}

// -- Unpublish -------------------------------------------------------------

function unpublishTimeline(userId, publishedId) {
  const db = getDb();
  const pub = db.prepare("SELECT * FROM published_timelines WHERE id=?").get(publishedId);
  if (!pub) throw Object.assign(new Error("Not found"), { status: 404 });
  if (pub.user_id !== userId) throw Object.assign(new Error("Not yours"), { status: 403 });
  db.prepare("DELETE FROM published_timelines WHERE id=?").run(publishedId);
  return { deleted: publishedId };
}

// -- YAML export -----------------------------------------------------------

function exportYAML(sessionId, userId) {
  const db = getDb();
  const session = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId);
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.user_id && session.user_id !== userId) {
    throw Object.assign(new Error("Not your session"), { status: 403 });
  }

  const timelines = db
    .prepare("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at")
    .all(sessionId);

  let yaml = `# ChronoWeave Timeline Export\n# Session: ${session.name}\n# Exported: ${new Date().toISOString()}\n\n`;

  timelines.forEach((tl) => {
    const events = db
      .prepare("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order")
      .all(tl.id);

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
  });

  return { yaml, filename: `${session.name.replace(/[^a-zA-Z0-9]+/g, "_")}.yaml` };
}

function esc(s) {
  return (s || "").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

module.exports = {
  publishTimeline,
  getPublishedTimeline,
  listPublished,
  unpublishTimeline,
  exportYAML,
};
