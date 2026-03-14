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
├── public/                    # Static frontend
│   ├── index.html
│   ├── css/                   # Modular stylesheets
│   │   ├── themes.css         # Theme definitions (5 themes)
│   │   ├── base.css           # Reset, tokens, shared atoms
│   │   ├── layout.css         # App shell, sidebar, landing, topbar
│   │   ├── controls.css       # View switch, chips, zoom, density
│   │   ├── views.css          # List, vertical, horizontal views
│   │   ├── modal.css          # Event detail modal + loader
│   │   └── reasoning.css      # Research reasoning panel
│   └── js/                    # Modular ES modules
│       ├── main.js            # Entry point — wires events + init
│       ├── state.js           # Global state, constants, colors
│       ├── dom.js             # DOM element references
│       ├── api.js             # Fetch helper, loader, localStorage
│       ├── utils.js           # esc(), hexAlpha()
│       ├── themes.js          # Theme switching
│       ├── sessions.js        # Session + timeline CRUD, chips
│       ├── research.js        # SSE streaming research
│       ├── reasoning.js       # Reasoning panel UI logic
│       ├── merge.js           # Merge/unmerge logic
│       ├── render.js          # View dispatcher + event gathering
│       ├── zoom.js            # Zoom controls
│       ├── density.js         # Importance density filter
│       ├── helpers.js         # Date parsing, importance scaling
│       ├── gaps.js            # Gap detection + cropped mapping
│       ├── modal.js           # Event detail modal
│       └── views/
│           ├── list.js        # List view renderer
│           ├── vertical.js    # Vertical (linear) view renderer
│           └── horizontal.js  # Horizontal view renderer
├── api/                       # Vercel serverless functions
│   └── index.js               # Catch-all API handler
├── lib/                       # Shared backend logic
│   ├── db.js                  # SQLite database layer
│   ├── llm.js                 # Multi-provider LLM (Claude/GPT/Grok)
│   └── routes.js              # Route handlers + SSE streaming
├── .env.example
├── server.js                  # Express server (local dev)
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
