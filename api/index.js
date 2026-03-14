/**
 * ChronoWeave — Vercel serverless catch-all handler.
 *
 * vercel.json rewrites /api/* to this function.
 * Parses the route and delegates to shared handlers in lib/routes.js.
 */

const routes = require("../lib/routes");

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.replace(/^\/api/, "").split("/").filter(Boolean);
  // parts examples: ["sessions"], ["sessions","abc"], ["sessions","abc","timelines"],
  //                  ["research"], ["merge"], ["unmerge"], ["timelines","abc"]

  try {
    // GET /api/sessions
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      return res.json(routes.listSessions());
    }

    // POST /api/sessions
    if (req.method === "POST" && parts[0] === "sessions" && !parts[1]) {
      const s = routes.createSession(req.body?.name);
      return res.status(201).json(s);
    }

    // DELETE /api/sessions/:sid
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      return res.json(routes.deleteSession(parts[1]));
    }

    // PUT /api/sessions/:sid
    if (req.method === "PUT" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      return res.json(routes.updateSession(parts[1], req.body?.name));
    }

    // GET /api/sessions/:sid/timelines
    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && parts[2] === "timelines") {
      return res.json(routes.listTimelines(parts[1]));
    }

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
          { session_id, query, color },
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
      return res.json(routes.unmergeTl(req.body?.timeline_id));
    }

    // DELETE /api/timelines/:tid
    if (req.method === "DELETE" && parts[0] === "timelines" && parts[1]) {
      return res.json(routes.deleteTimeline(parts[1]));
    }

    return res.status(404).json({ detail: "Not found" });
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
};
