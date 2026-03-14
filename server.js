/**
 * ChronoWeave -- Local development server (Express).
 *
 * - Serves static files from /public
 * - Mounts all API routes at /api/*
 * - Uses dotenv to load .env automatically
 *
 * Not used in production (Vercel uses api/index.js instead).
 */

require('dotenv').config();

const express = require('express');
const path    = require('path');
const routes  = require('./lib/routes');

const app  = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS (helpful in dev)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- API Routes ----

app.get('/api/sessions', (req, res) => {
  res.json(routes.listSessions());
});

app.post('/api/sessions', (req, res) => {
  const s = routes.createSession(req.body?.name);
  res.status(201).json(s);
});

app.delete('/api/sessions/:sid', (req, res) => {
  res.json(routes.deleteSession(req.params.sid));
});

app.put('/api/sessions/:sid', (req, res) => {
  res.json(routes.updateSession(req.params.sid, req.body?.name));
});

app.get('/api/sessions/:sid/timelines', (req, res) => {
  res.json(routes.listTimelines(req.params.sid));
});

// SSE streaming research endpoint
app.get('/api/research/stream', async (req, res) => {
  const { session_id, query, color } = req.query;
  if (!session_id || !query) {
    return res.status(400).json({ detail: 'session_id and query required' });
  }
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
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
    if (!res.writableEnded) send('error', { message: err.message });
  }
  if (!res.writableEnded) {
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
});

app.post('/api/research', async (req, res, next) => {
  try {
    const tl = await routes.researchTopic(req.body);
    res.json(tl);
  } catch (err) { next(err); }
});

app.post('/api/merge', async (req, res, next) => {
  try {
    const tl = await routes.mergeTimelines(req.body);
    res.json(tl);
  } catch (err) { next(err); }
});

app.post('/api/unmerge', (req, res) => {
  res.json(routes.unmergeTl(req.body?.timeline_id));
});

app.delete('/api/timelines/:tid', (req, res) => {
  res.json(routes.deleteTimeline(req.params.tid));
});

// Catch-all -> index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ detail: err.message });
});

app.listen(PORT, () => {
  console.log(`ChronoWeave running at http://localhost:${PORT}`);
});
