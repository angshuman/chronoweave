# ChronoWeave

A timeline research webapp that uses AI to research any topic and generate interactive, chronological timelines. Built with a Perplexity Computer-inspired dark UI.

## Features

- **AI-Powered Research** — Enter any topic and get a rich timeline of events with dates, descriptions, and tags
- **Dual View Modes** — Linear view (proportional time spacing with lane-based overlap handling) and List view (sequential cards)
- **Sessions** — Organize research into separate sessions, each with multiple timelines
- **Intelligent Merge** — Merge multiple timelines with AI-powered deduplication that finds matching events across sources
- **Unmerge** — Reverse any merge to restore original timelines
- **Merge on Merge** — Stack multiple merges together
- **Source Preservation** — Merged timelines visually preserve which source each event came from (color-coded dots)
- **Duration Events** — Events can have start and end dates; overlapping events are arranged in lanes
- **Event Modal** — Click any event to see full details, sources, and tags

## Architecture

- **Backend**: FastAPI + SQLite + Anthropic Claude API
- **Frontend**: Vanilla HTML/CSS/JS with Lucide icons
- **Database**: SQLite with sessions → timelines → events schema

## Setup

### Prerequisites

- Python 3.10+
- An Anthropic API key (Claude)

### Backend

```bash
pip install fastapi uvicorn anthropic
export ANTHROPIC_API_KEY="your-key-here"
python api_server.py
```

The API server runs on port 8000.

### Frontend

Serve the static files (index.html, style.css, app.js) with any static file server:

```bash
npx serve -l 3000
```

Open http://localhost:3000 in your browser.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | List all sessions |
| POST | `/sessions` | Create a new session |
| DELETE | `/sessions/{id}` | Delete a session |
| GET | `/sessions/{id}/timelines` | Get timelines + events for a session |
| POST | `/sessions/{id}/research` | Research a topic and create a timeline |
| POST | `/sessions/{id}/merge` | Intelligently merge selected timelines |
| POST | `/timelines/{id}/unmerge` | Unmerge a merged timeline |
| DELETE | `/timelines/{id}` | Delete a timeline |

## License

MIT
