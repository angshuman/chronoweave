/**
 * ChronoWeave -- Database layer (better-sqlite3)
 *
 * Works in both Express (server.js) and Vercel serverless (api/).
 * On Vercel the DB lives in /tmp and is ephemeral per cold-start;
 * for persistence replace with Turso/PlanetScale/etc.
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH =
  process.env.CHRONOWEAVE_DB ||
  (process.env.VERCEL
    ? path.join("/tmp", "chronoweave.db")
    : path.join(__dirname, "..", "data.db"));

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initDb(_db);
  return _db;
}

function initDb(db) {
  db.exec(`
    /* -- Original tables -------------------------------------------------- */
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
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

    /* -- Users ------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      credits INTEGER DEFAULT 1000,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    /* -- Credit transactions ---------------------------------------------- */
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    /* -- Published timelines ---------------------------------------------- */
    CREATE TABLE IF NOT EXISTS published_timelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    /* -- Stripe customer map ---------------------------------------------- */
    CREATE TABLE IF NOT EXISTS stripe_customers (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    /* -- Indexes ---------------------------------------------------------- */
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_published_slug ON published_timelines(slug);
    CREATE INDEX IF NOT EXISTS idx_published_user ON published_timelines(user_id);
  `);

  // Add user_id column to sessions if it doesn't exist (migration)
  try {
    db.prepare("SELECT user_id FROM sessions LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT");
  }
}

module.exports = { getDb };
