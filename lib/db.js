/**
 * ChronoWeave -- Database layer (@libsql/client)
 *
 * Dual mode:
 *   - Local dev:  file:./data.db   (SQLite file, no network)
 *   - Production: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (Turso cloud)
 *
 * All methods are async. The API mirrors a subset of better-sqlite3
 * but returns Promises.
 */

const { createClient } = require("@libsql/client");
const path = require("path");

let _db = null;
let _initialized = false;

function getClient() {
  if (_db) return _db;

  if (process.env.TURSO_DATABASE_URL) {
    // Production: connect to Turso
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN || "",
    });
    console.log("[DB] Connected to Turso:", process.env.TURSO_DATABASE_URL.slice(0, 40) + "...");
  } else {
    // Local dev: SQLite file
    const dbPath = process.env.CHRONOWEAVE_DB || path.join(__dirname, "..", "data.db");
    _db = createClient({ url: `file:${dbPath}` });
    console.log("[DB] Using local SQLite:", dbPath);
  }

  return _db;
}

/**
 * Initialize schema. Must be called once before queries.
 */
async function initDb() {
  if (_initialized) return;
  const db = getClient();

  await db.batch([
    /* -- Original tables -------------------------------------------------- */
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS timelines (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT,
      color TEXT DEFAULT '#6e7bf2',
      created_at TEXT DEFAULT (datetime('now')),
      is_merged INTEGER DEFAULT 0,
      merged_from TEXT,
      merged_event_map TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS events (
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
    )`,

    /* -- Users ------------------------------------------------------------ */
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      credits INTEGER DEFAULT 1000,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    /* -- Credit transactions ---------------------------------------------- */
    `CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    /* -- Published timelines ---------------------------------------------- */
    `CREATE TABLE IF NOT EXISTS published_timelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    /* -- Stripe customer map ---------------------------------------------- */
    `CREATE TABLE IF NOT EXISTS stripe_customers (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    /* -- Indexes ---------------------------------------------------------- */
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_published_slug ON published_timelines(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_published_user ON published_timelines(user_id)`,
  ]);

  _initialized = true;
}

// -- Convenience wrappers --------------------------------------------------

/**
 * Execute a single SQL statement. Returns { rows, rowsAffected }.
 *  - get(sql, args)       → first row or null
 *  - all(sql, args)       → array of rows
 *  - run(sql, args)       → { rowsAffected }
 *  - exec(sql)            → raw execute (DDL, etc.)
 */
async function get(sql, args = []) {
  const db = getClient();
  const rs = await db.execute({ sql, args });
  return rs.rows.length > 0 ? rs.rows[0] : null;
}

async function all(sql, args = []) {
  const db = getClient();
  const rs = await db.execute({ sql, args });
  return rs.rows;
}

async function run(sql, args = []) {
  const db = getClient();
  const rs = await db.execute({ sql, args });
  return { rowsAffected: rs.rowsAffected };
}

async function exec(sql) {
  const db = getClient();
  await db.execute(sql);
}

/**
 * Execute multiple statements in a batch (transaction-like on Turso).
 */
async function batch(statements) {
  const db = getClient();
  return db.batch(statements);
}

module.exports = { getClient, initDb, get, all, run, exec, batch };
