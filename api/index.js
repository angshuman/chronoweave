/**
 * ChronoWeave -- Vercel serverless catch-all handler.
 *
 * vercel.json rewrites /api/* to this function.
 * Parses the route and delegates to shared handlers in lib/.
 */

const routes = require("../lib/routes");
const { initDb } = require("../lib/db");
const { authMiddleware, requireAuth, handleGoogleLogin, handleGetMe, GOOGLE_CLIENT_ID, verifyJwt, getUserById } = require("../lib/auth");
const { TIERS, getBalance, getTransactions } = require("../lib/credits");
const { createCheckoutSession, handleWebhook } = require("../lib/stripe");
const { publishTimeline, getPublishedTimeline, listPublished, discoverTimelines, toggleLike, getLikeStatus, unpublishTimeline, exportYAML, generatePreviewSVG } = require("../lib/publish");

let _dbReady = false;

/**
 * Ensure DB schema is initialized (runs once per cold start).
 */
async function ensureDb() {
  if (_dbReady) return;
  await initDb();
  _dbReady = true;
}

/**
 * Extract user from Authorization header (inline middleware for serverless).
 */
async function extractUser(req) {
  let token = null;
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    // Check query param (for SSE/EventSource which can't set headers)
    const url = new URL(req.url, `http://${req.headers.host}`);
    token = url.searchParams.get("token");
  }
  if (token) {
    const decoded = verifyJwt(token);
    if (decoded) {
      return await getUserById(decoded.sub);
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Initialize DB on first request (cold start)
  await ensureDb();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.replace(/^\/api/, "").split("/").filter(Boolean);

  // Extract user for all requests
  const user = await extractUser(req);
  req.user = user;

  try {
    // == Auth routes ==

    // POST /api/auth/google
    if (req.method === "POST" && parts[0] === "auth" && parts[1] === "google") {
      return await handleGoogleLogin(req, res);
    }

    // GET /api/auth/me
    if (req.method === "GET" && parts[0] === "auth" && parts[1] === "me") {
      return handleGetMe(req, res);
    }

    // GET /api/auth/config
    if (req.method === "GET" && parts[0] === "auth" && parts[1] === "config") {
      return res.json({ google_client_id: GOOGLE_CLIENT_ID });
    }

    // == Credits routes ==

    // GET /api/credits
    if (req.method === "GET" && parts[0] === "credits" && !parts[1]) {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      return res.json({ credits: await getBalance(user.id) });
    }

    // GET /api/credits/transactions
    if (req.method === "GET" && parts[0] === "credits" && parts[1] === "transactions") {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      return res.json(await getTransactions(user.id));
    }

    // GET /api/credits/tiers
    if (req.method === "GET" && parts[0] === "credits" && parts[1] === "tiers") {
      return res.json(TIERS);
    }

    // == Stripe routes ==

    // POST /api/stripe/checkout
    if (req.method === "POST" && parts[0] === "stripe" && parts[1] === "checkout") {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      const result = await createCheckoutSession(user.id, req.body?.tier_id);
      return res.json(result);
    }

    // POST /api/stripe/webhook
    if (req.method === "POST" && parts[0] === "stripe" && parts[1] === "webhook") {
      // For Vercel, raw body is in req.body as a buffer if configured
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const result = await handleWebhook(rawBody, req.headers["stripe-signature"]);
      return res.json(result);
    }

    // == Publish routes ==

    // POST /api/publish
    if (req.method === "POST" && parts[0] === "publish" && !parts[1]) {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      const result = await publishTimeline(user.id, req.body?.session_id, req.body?.title);
      return res.json(result);
    }

    // GET /api/published
    if (req.method === "GET" && parts[0] === "published" && !parts[1]) {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      return res.json(await listPublished(user.id));
    }

    // DELETE /api/published/:id
    if (req.method === "DELETE" && parts[0] === "published" && parts[1]) {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      return res.json(await unpublishTimeline(user.id, parts[1]));
    }

    // GET /api/discover (public -- no auth)
    if (req.method === "GET" && parts[0] === "discover" && !parts[1]) {
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      return res.json(await discoverTimelines(limit));
    }

    // POST /api/like/:id (toggle like -- requires auth)
    if (req.method === "POST" && parts[0] === "like" && parts[1]) {
      if (!user) return res.status(401).json({ detail: "Authentication required" });
      return res.json(await toggleLike(user.id, parts[1]));
    }

    // GET /api/like/:id (check like status)
    if (req.method === "GET" && parts[0] === "like" && parts[1]) {
      return res.json(await getLikeStatus(user?.id, parts[1]));
    }

    // GET /api/preview/:slug.svg (public -- preview card)
    if (req.method === "GET" && parts[0] === "preview" && parts[1]) {
      const slug = parts[1].replace(/\.svg$/, "");
      const svg = await generatePreviewSVG(slug);
      if (!svg) return res.status(404).json({ detail: "Not found" });
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(svg);
    }

    // GET /api/p/:slug (public -- no auth)
    if (req.method === "GET" && parts[0] === "p" && parts[1]) {
      const pub = await getPublishedTimeline(parts[1]);
      if (!pub) return res.status(404).json({ detail: "Not found" });
      return res.json(pub);
    }

    // == Export ==

    // GET /api/export/:sessionId
    if (req.method === "GET" && parts[0] === "export" && parts[1]) {
      const { yaml, filename } = await exportYAML(parts[1], user?.id);
      res.setHeader("Content-Type", "text/yaml");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(yaml);
    }

    // == Sessions ==

    // GET /api/sessions
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      return res.json(await routes.listSessions(user?.id));
    }

    // POST /api/sessions
    if (req.method === "POST" && parts[0] === "sessions" && !parts[1]) {
      const s = await routes.createSession(req.body?.name, user?.id);
      return res.status(201).json(s);
    }

    // DELETE /api/sessions/:sid
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      return res.json(await routes.deleteSession(parts[1], user?.id));
    }

    // PUT /api/sessions/:sid
    if (req.method === "PUT" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      return res.json(await routes.updateSession(parts[1], req.body?.name, user?.id));
    }

    // GET /api/sessions/:sid/timelines
    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && parts[2] === "timelines") {
      return res.json(await routes.listTimelines(parts[1]));
    }

    // == Research ==

    // GET /api/research/stream (SSE streaming)
    if (req.method === "GET" && parts[0] === "research" && parts[1] === "stream") {
      const { session_id, query, color } = url.searchParams ? Object.fromEntries(url.searchParams) : req.query || {};
      if (!session_id || !query) {
        return res.status(400).json({ detail: "session_id and query required" });
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (type, data) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        await routes.researchTopicStream(
          { session_id, query, color, userId: user?.id },
          (type, data) => { if (!res.writableEnded) send(type, data); }
        );
      } catch (err) {
        if (!res.writableEnded) send("error", { message: err.message });
      }
      if (!res.writableEnded) {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }
      return;
    }

    // POST /api/research (non-streaming fallback)
    if (req.method === "POST" && parts[0] === "research" && !parts[1]) {
      const tl = await routes.researchTopic(req.body);
      return res.json(tl);
    }

    // POST /api/merge
    if (req.method === "POST" && parts[0] === "merge") {
      const tl = await routes.mergeTimelines(req.body);
      return res.json(tl);
    }

    // POST /api/unmerge
    if (req.method === "POST" && parts[0] === "unmerge") {
      return res.json(await routes.unmergeTl(req.body?.timeline_id));
    }

    // DELETE /api/timelines/:tid
    if (req.method === "DELETE" && parts[0] === "timelines" && parts[1]) {
      return res.json(await routes.deleteTimeline(parts[1]));
    }

    return res.status(404).json({ detail: "Not found" });
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
};
