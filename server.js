#!/usr/bin/env node
require("dotenv").config();

/**
 * ChronoWeave -- Express server for local development.
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
const { initDb } = require("./lib/db");
const { authMiddleware, requireAuth, handleGoogleLogin, handleGetMe, GOOGLE_CLIENT_ID } = require("./lib/auth");
const { TIERS, getBalance, getTransactions } = require("./lib/credits");
const { createCheckoutSession, handleWebhook } = require("./lib/stripe");
const { publishTimeline, getPublishedTimeline, listPublished, unpublishTimeline, exportYAML } = require("./lib/publish");

const PORT = parseInt(process.env.PORT || "8000", 10);
const app = express();

app.use(cors());

// Stripe webhook needs raw body -- must be before express.json()
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const result = await handleWebhook(req.body, req.headers["stripe-signature"]);
    res.json(result);
  } catch (err) {
    console.error("Stripe webhook error:", err.message);
    res.status(400).json({ detail: err.message });
  }
});

app.use(express.json());

// Auth middleware on all routes (non-blocking -- sets req.user if valid)
app.use(authMiddleware);

// -- Static frontend -------------------------------------------------------
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      }
      res.setHeader("Cache-Control", "no-store");
    },
  })
);

// -- Auth routes -----------------------------------------------------------
app.post("/api/auth/google", handleGoogleLogin);
app.get("/api/auth/me", handleGetMe);
app.get("/api/auth/config", (_req, res) => {
  res.json({ google_client_id: GOOGLE_CLIENT_ID });
});

// -- Credits routes --------------------------------------------------------
app.get("/api/credits", requireAuth, async (req, res) => {
  try {
    res.json({ credits: await getBalance(req.user.id) });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get("/api/credits/transactions", requireAuth, async (req, res) => {
  try {
    res.json(await getTransactions(req.user.id));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get("/api/credits/tiers", (_req, res) => {
  res.json(TIERS);
});

// -- Stripe routes ---------------------------------------------------------
app.post("/api/stripe/checkout", requireAuth, async (req, res) => {
  try {
    const { tier_id } = req.body;
    const result = await createCheckoutSession(req.user.id, tier_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Sessions (user-scoped) ------------------------------------------------
app.get("/api/sessions", async (req, res) => {
  try {
    res.json(await routes.listSessions(req.user?.id));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post("/api/sessions", async (req, res) => {
  try {
    const s = await routes.createSession(req.body.name, req.user?.id);
    res.status(201).json(s);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete("/api/sessions/:sid", async (req, res) => {
  try {
    res.json(await routes.deleteSession(req.params.sid, req.user?.id));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.put("/api/sessions/:sid", async (req, res) => {
  try {
    res.json(await routes.updateSession(req.params.sid, req.body.name, req.user?.id));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Timelines -------------------------------------------------------------
app.get("/api/sessions/:sid/timelines", async (req, res) => {
  try {
    res.json(await routes.listTimelines(req.params.sid));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// -- Research (non-streaming fallback) -------------------------------------
app.post("/api/research", async (req, res) => {
  try {
    const tl = await routes.researchTopic(req.body);
    res.json(tl);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Research (SSE streaming) ----------------------------------------------
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
      { session_id, query, color, userId: req.user?.id },
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

// -- Merge -----------------------------------------------------------------
app.post("/api/merge", async (req, res) => {
  try {
    const tl = await routes.mergeTimelines(req.body);
    res.json(tl);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Unmerge ---------------------------------------------------------------
app.post("/api/unmerge", async (req, res) => {
  try {
    res.json(await routes.unmergeTl(req.body.timeline_id));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Delete timeline -------------------------------------------------------
app.delete("/api/timelines/:tid", async (req, res) => {
  try {
    res.json(await routes.deleteTimeline(req.params.tid));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// -- Publish routes --------------------------------------------------------
app.post("/api/publish", requireAuth, async (req, res) => {
  try {
    const result = await publishTimeline(req.user.id, req.body.session_id, req.body.title);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.get("/api/published", requireAuth, async (req, res) => {
  try {
    res.json(await listPublished(req.user.id));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete("/api/published/:id", requireAuth, async (req, res) => {
  try {
    res.json(await unpublishTimeline(req.user.id, req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Public view (no auth required) ----------------------------------------
app.get("/api/p/:slug", async (req, res) => {
  try {
    const pub = await getPublishedTimeline(req.params.slug);
    if (!pub) return res.status(404).json({ detail: "Not found" });
    res.json(pub);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// -- YAML Export -----------------------------------------------------------
app.get("/api/export/:sessionId", async (req, res) => {
  try {
    const { yaml, filename } = await exportYAML(req.params.sessionId, req.user?.id);
    res.setHeader("Content-Type", "text/yaml");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(yaml);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// -- Public timeline viewer ------------------------------------------------
app.get("/p/:slug", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "viewer.html"));
});

// -- SPA fallback ----------------------------------------------------------
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -- Start server (initialize DB first) ------------------------------------
(async () => {
  try {
    await initDb();
    console.log("[DB] Schema initialized");
  } catch (err) {
    console.error("[DB] Failed to initialize:", err.message);
    process.exit(1);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ChronoWeave server listening on http://localhost:${PORT}`);
  });
})();
