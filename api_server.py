#!/usr/bin/env python3
"""ChronoWeave API — Timeline research with start/end dates, intelligent merge."""
import json
import sqlite3
import uuid
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic

DB_PATH = "/home/user/workspace/chronoweave/data.db"

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS timelines (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            query TEXT,
            color TEXT DEFAULT '#6e7bf2',
            created_at TEXT DEFAULT (datetime('now')),
            is_merged INTEGER DEFAULT 0,
            merged_from TEXT,
            merged_event_map TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
            start_date TEXT NOT NULL,
            end_date TEXT,
            date_precision TEXT DEFAULT 'day',
            title TEXT NOT NULL,
            description TEXT,
            category TEXT DEFAULT '',
            source_timeline_id TEXT,
            source_timeline_name TEXT,
            source_color TEXT,
            sort_order INTEGER DEFAULT 0,
            importance INTEGER DEFAULT 5,
            tags TEXT DEFAULT '[]'
        );
    """)
    db.close()

@asynccontextmanager
async def lifespan(app):
    init_db()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Models ────────────────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    name: str = "New Session"

class TimelineResearch(BaseModel):
    session_id: str
    query: str
    name: str = ""
    color: str = "#6e7bf2"

class MergeRequest(BaseModel):
    session_id: str
    timeline_ids: list[str]
    name: str = ""

class UnmergeRequest(BaseModel):
    timeline_id: str

# ── LLM ───────────────────────────────────────────────────────────────────────
client = Anthropic()

RESEARCH_PROMPT = """You are a timeline research assistant. Given a topic, produce a detailed chronological timeline of key events. Some events are point-in-time, others span a duration.

Topic: {query}

Return a JSON array of events. Each event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null. Use non-null for events with meaningful duration (wars, programs, eras, construction periods, etc.). Use null for point-in-time events.
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail
- "importance": integer 1-10 (10 = most significant)
- "category": short category label like "milestone", "conflict", "policy", "discovery", "launch", "era", etc.
- "tags": array of 1-3 relevant tags

IMPORTANT: Include a MIX of point events (end_date=null) and duration events (end_date set). At least 30% should have durations. Produce 10-15 events. Be factually accurate.
Return ONLY the JSON array, no markdown fences."""

MERGE_PROMPT = """You are a timeline merge assistant. Merge events from multiple timelines intelligently.

Rules:
1. Events referring to the SAME real-world occurrence → merge into one, combine descriptions
2. Unique events → keep as-is
3. Sort chronologically by start_date
4. Preserve start_date and end_date from originals (use best available)

Input:
{data}

Return a JSON array where each event has:
- "start_date", "end_date", "date_precision", "title", "description", "importance", "category", "tags"
- "source_ids": array of timeline IDs this came from
- "original_event_ids": array of original event IDs merged into this

Return ONLY the JSON array."""

async def llm_call(prompt: str, max_tokens: int = 6000) -> list[dict]:
    loop = asyncio.get_event_loop()
    msg = await loop.run_in_executor(None, lambda: client.messages.create(
        model="claude_sonnet_4_6", max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    ))
    text = msg.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/api/sessions")
def list_sessions():
    db = get_db()
    rows = db.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
    out = []
    for r in rows:
        cnt = db.execute("SELECT COUNT(*) FROM timelines WHERE session_id=?", [r["id"]]).fetchone()[0]
        out.append({**dict(r), "timeline_count": cnt})
    db.close()
    return out

@app.post("/api/sessions", status_code=201)
def create_session(data: SessionCreate):
    db = get_db()
    sid = str(uuid.uuid4())[:8]
    db.execute("INSERT INTO sessions (id, name) VALUES (?,?)", [sid, data.name])
    db.commit()
    row = dict(db.execute("SELECT * FROM sessions WHERE id=?", [sid]).fetchone())
    db.close()
    return row

@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    db = get_db()
    db.execute("DELETE FROM sessions WHERE id=?", [sid])
    db.commit()
    db.close()
    return {"deleted": sid}

@app.put("/api/sessions/{sid}")
def update_session(sid: str, data: SessionCreate):
    db = get_db()
    db.execute("UPDATE sessions SET name=?, updated_at=datetime('now') WHERE id=?", [data.name, sid])
    db.commit()
    db.close()
    return {"updated": sid}

@app.get("/api/sessions/{sid}/timelines")
def list_timelines(sid: str):
    db = get_db()
    rows = db.execute("SELECT * FROM timelines WHERE session_id=? ORDER BY created_at", [sid]).fetchall()
    out = []
    for r in rows:
        tl = dict(r)
        evts = db.execute("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [r["id"]]).fetchall()
        tl["events"] = [dict(e) for e in evts]
        for key in ("merged_from", "merged_event_map"):
            if tl[key]:
                tl[key] = json.loads(tl[key])
        out.append(tl)
    db.close()
    return out

@app.post("/api/research")
async def research_topic(data: TimelineResearch):
    db = get_db()
    if not db.execute("SELECT 1 FROM sessions WHERE id=?", [data.session_id]).fetchone():
        db.close()
        raise HTTPException(404, "Session not found")

    events = await llm_call(RESEARCH_PROMPT.format(query=data.query))

    tid = str(uuid.uuid4())[:8]
    name = data.name or data.query[:60]
    db.execute("INSERT INTO timelines (id,session_id,name,query,color) VALUES (?,?,?,?,?)",
               [tid, data.session_id, name, data.query, data.color])

    for i, e in enumerate(events):
        eid = str(uuid.uuid4())[:8]
        db.execute(
            "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [eid, tid, e.get("start_date",""), e.get("end_date") or None, e.get("date_precision","day"),
             e.get("title",""), e.get("description",""), e.get("category",""), i,
             e.get("importance",5), json.dumps(e.get("tags",[])),
             tid, name, data.color])

    db.execute("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [data.session_id])
    db.commit()

    tl = dict(db.execute("SELECT * FROM timelines WHERE id=?", [tid]).fetchone())
    evts = db.execute("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [tid]).fetchall()
    tl["events"] = [dict(e) for e in evts]
    db.close()
    return tl

@app.post("/api/merge")
async def merge_timelines(data: MergeRequest):
    db = get_db()
    tl_data = []
    src_tls = []
    for tid in data.timeline_ids:
        tl = db.execute("SELECT * FROM timelines WHERE id=?", [tid]).fetchone()
        if not tl:
            db.close()
            raise HTTPException(404, f"Timeline {tid} not found")
        tld = dict(tl)
        src_tls.append(tld)
        evts = db.execute("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date", [tid]).fetchall()
        el = []
        for e in evts:
            ed = dict(e)
            el.append({
                "event_id": ed["id"], "timeline_id": tid,
                "timeline_name": tld["name"], "timeline_color": tld["color"],
                "start_date": ed["start_date"], "end_date": ed["end_date"],
                "date_precision": ed["date_precision"],
                "title": ed["title"], "description": ed["description"],
                "importance": ed["importance"], "category": ed.get("category",""),
                "tags": json.loads(ed["tags"]) if ed["tags"] else [],
                "source_timeline_id": ed.get("source_timeline_id") or tid,
                "source_timeline_name": ed.get("source_timeline_name") or tld["name"],
                "source_color": ed.get("source_color") or tld["color"],
            })
        tl_data.append({"timeline_id": tid, "timeline_name": tld["name"], "timeline_color": tld["color"], "events": el})

    merged_events = await llm_call(MERGE_PROMPT.format(data=json.dumps(tl_data, indent=2)), max_tokens=10000)

    mtid = str(uuid.uuid4())[:8]
    mname = data.name or "Merged: " + " + ".join(t["name"] for t in src_tls)
    mfrom = json.dumps(data.timeline_ids)
    src_lookup = {t["timeline_id"]: {"name": t["timeline_name"], "color": t["timeline_color"]} for t in tl_data}

    db.execute("INSERT INTO timelines (id,session_id,name,color,is_merged,merged_from) VALUES (?,?,?,?,1,?)",
               [mtid, data.session_id, mname, "#a78bfa", mfrom])

    emap = []
    for i, e in enumerate(merged_events):
        eid = str(uuid.uuid4())[:8]
        sids = e.get("source_ids", [])
        oids = e.get("original_event_ids", [])
        multi = len(sids) > 1
        if multi:
            src_json = json.dumps([{"id":s,"name":src_lookup.get(s,{}).get("name","?"),"color":src_lookup.get(s,{}).get("color","#6e7bf2")} for s in sids])
            col_json = json.dumps([src_lookup.get(s,{}).get("color","#6e7bf2") for s in sids])
        else:
            si = src_lookup.get(sids[0],{"name":"?","color":"#6e7bf2"}) if sids else {"name":mname,"color":"#a78bfa"}
            src_json = si["name"]
            col_json = si["color"]

        db.execute(
            "INSERT INTO events (id,timeline_id,start_date,end_date,date_precision,title,description,category,sort_order,importance,tags,source_timeline_id,source_timeline_name,source_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [eid, mtid, e.get("start_date",""), e.get("end_date") or None, e.get("date_precision","day"),
             e.get("title",""), e.get("description",""), e.get("category",""), i,
             e.get("importance",5), json.dumps(e.get("tags",[])),
             json.dumps(sids) if multi else (sids[0] if sids else mtid),
             src_json, col_json])
        emap.append({"merged_event_id": eid, "original_event_ids": oids, "source_ids": sids})

    db.execute("UPDATE timelines SET merged_event_map=? WHERE id=?", [json.dumps(emap), mtid])
    db.execute("UPDATE sessions SET updated_at=datetime('now') WHERE id=?", [data.session_id])
    db.commit()

    tl = dict(db.execute("SELECT * FROM timelines WHERE id=?", [mtid]).fetchone())
    evts = db.execute("SELECT * FROM events WHERE timeline_id=? ORDER BY start_date, sort_order", [mtid]).fetchall()
    tl["events"] = [dict(e) for e in evts]
    for k in ("merged_from","merged_event_map"):
        if tl[k]: tl[k] = json.loads(tl[k])
    db.close()
    return tl

@app.post("/api/unmerge")
def unmerge_timeline(data: UnmergeRequest):
    db = get_db()
    tl = db.execute("SELECT * FROM timelines WHERE id=?", [data.timeline_id]).fetchone()
    if not tl: raise HTTPException(404, "Not found")
    if not tl["is_merged"]: raise HTTPException(400, "Not merged")
    db.execute("DELETE FROM timelines WHERE id=?", [data.timeline_id])
    db.commit()
    db.close()
    return {"unmerged": data.timeline_id, "original_timelines": json.loads(tl["merged_from"]) if tl["merged_from"] else []}

@app.delete("/api/timelines/{tid}")
def delete_timeline(tid: str):
    db = get_db()
    db.execute("DELETE FROM timelines WHERE id=?", [tid])
    db.commit()
    db.close()
    return {"deleted": tid}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
