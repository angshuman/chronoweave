# ChronoWeave

AI-powered timeline research app. Research any topic and get an interactive, chronological timeline with gap cropping, importance-based visuals, and multiple themes.

## Features

- **AI-Powered Research** — Enter any topic and get a rich timeline of events
- **Three View Modes** — Vertical (proportional), Horizontal (above/below axis), List
- **Sessions** — Organize research into separate threads
- **Intelligent Merge / Unmerge** — AI-powered deduplication across timelines
- **Gap Cropping** — Large time gaps compressed with visual break indicators
- **Importance Scaling** — Card size, opacity, glow all scale by event importance (1-10)
- **5 Themes** — Midnight, Slate, Ember, Forest, Light
- **Zoom & Density** — Ctrl+scroll zoom, importance-based density filter
- **Duration Events** — Events with start/end dates laid out in lanes

## Architecture

- **Backend**: Node.js + Express + better-sqlite3 + Anthropic Claude or OpenAI GPT-4o
- **Frontend**: Vanilla HTML/CSS/JS + Lucide icons
- **Deployment**: Vercel-ready (serverless functions + static assets)

## Local Development

```bash
npm install
```

Then start the server with whichever LLM key you have:

```bash
# Option A: OpenAI
OPENAI_API_KEY=sk-... npm run dev

# Option B: Anthropic
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

The server auto-detects the provider based on which key is set. If both are set, Anthropic takes priority.

Open http://localhost:8000

## Deploy to Vercel

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variable: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
4. Deploy

> **Note**: On Vercel, the SQLite database lives in `/tmp` and is ephemeral (resets on cold starts). For persistent storage, swap `better-sqlite3` with [Turso](https://turso.tech), [PlanetScale](https://planetscale.com), or Vercel Postgres.

## Project Structure

```
chronoweave/
├── public/            # Static frontend
│   ├── index.html
│   ├── app.js
│   └── style.css
├── api/               # Vercel serverless functions
│   └── index.js       # Catch-all API handler
├── lib/               # Shared business logic
│   ├── db.js          # SQLite database layer
│   ├── llm.js         # LLM helpers (auto-detects Anthropic or OpenAI)
│   └── routes.js      # Route handlers
├── server.js          # Express server (local dev)
├── package.json
├── vercel.json
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create a new session |
| DELETE | `/api/sessions/:id` | Delete a session |
| PUT | `/api/sessions/:id` | Update session name |
| GET | `/api/sessions/:id/timelines` | Get timelines + events |
| POST | `/api/research` | Research a topic |
| POST | `/api/merge` | Merge selected timelines |
| POST | `/api/unmerge` | Unmerge a merged timeline |
| DELETE | `/api/timelines/:id` | Delete a timeline |

## License

MIT
