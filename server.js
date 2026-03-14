#!/usr/bin/env node
require("dotenv").config();

/**
 * ChronoWeave — Express server for local development.
 *
 * Usage:  npm run dev            (reads .env file automatically)
 *    or:  OPENAI_API_KEY=sk-... npm run dev
 *
 * The server auto-detects which LLM provider to use based on which
 * API key is set. Priority: ANTHROPIC_API_KEY > OPENAI_API_KEY > XAI_API_KEY
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const routes = require("./lib/routes");

const PORT = parseInt(process.env.PORT || "8000", 10);
const app = express();
app.use(cors());
app.use(express.json());

// ── Static frontend ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API routes ────────────────────────────────────────────────────────────────

// Sessions
app.get("/api/sessions", (_req, res) => {
  res.json(routes.listSessions());
});

app.post("/api/sessions", (req, res) => {
  const s = routes.createSession(req.body.name);
  res.status(201).json(s);
});

app.delete("/api/sessions/:sid", (req, res) => {
  res.json(routes.deleteSession(req.params.sid));
});

app.put("/api/sessions/:sid", (req, res) => {
  res.json(routes.updateSession(req.params.sid, req.body.name));
});

// Timelines
app.get("/api/sessions/:sid/timelines", (req, res) => {
  res.json(routes.listTimelines(req.params.sid));
});

// Research (non-streaming fallback)
app.post("/api/research", async (req, res) => {
  try {
    const tl = await routes.researchTopic(req.body);
    res.json(tl);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Research (SSE streaming)
app.get("/api/research/stream", async (req, res) => {
  const { session_id, query, color } = req.query;
  if (!session_id || !query) {
    return res.status(400).json({ detail: "session_id and query required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await routes.researchTopicStream(
      { session_id, query, color },
      (type, data) => {
        if (!res.writableEnded) send(type, data);
      }
    );
  } catch (err) {
    if (!res.writableEnded) send("error", { message: err.message });
  }
  if (!res.writableEnded) {
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }
});

// Merge
app.post("/api/merge", async (req, res) => {
  try {
    const tl = await routes.mergeTimelines(req.body);
    res.json(tl);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Unmerge
app.post("/api/unmerge", (req, res) => {
  try {
    res.json(routes.unmergeTl(req.body.timeline_id));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Delete timeline
app.delete("/api/timelines/:tid", (req, res) => {
  res.json(routes.deleteTimeline(req.params.tid));
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChronoWeave server listening on http://localhost:${PORT}`);
});
