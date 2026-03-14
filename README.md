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

- **Backend**: Node.js + Express + better-sqlite3 + Anthropic Claude / OpenAI GPT-5.4 / xAI Grok
- **Frontend**: Vanilla HTML/CSS/JS + Lucide icons
- **Deployment**: Vercel-ready (serverless functions + static assets)

## Local Development

```bash
npm install
cp .env.example .env    # then add your API key
npm run dev
```

Open http://localhost:8000

The `.env` file is loaded automatically via `dotenv`. Set any ONE of these keys:

| Variable | Provider | Default Model |
|----------|----------|---------------|
| `ANTHROPIC_API_KEY` | Anthropic | Claude Sonnet 4.6 |
| `OPENAI_API_KEY` | OpenAI | GPT-5.4 |
| `XAI_API_KEY` | xAI | Grok 4.20 |

If multiple keys are set, priority is Anthropic > OpenAI > Grok. Override the model with `LLM_MODEL=<model-id>`.

## Deploy to Vercel

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variable: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY`
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
│   ├── llm.js         # LLM helpers (Anthropic / OpenAI / Grok)
│   └── routes.js      # Route handlers
├── .env.example       # Template for local env vars
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
