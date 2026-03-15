/**
 * ChronoWeave -- Credits system
 *
 * Credit economy:
 *   - New users get 1,000 free credits
 *   - Research query (new topic): 10 credits
 *   - Refine query (follow-up): 5 credits
 *   - Merge operation: 5 credits
 *   - Publishing a timeline: 0 credits (free)
 *   - YAML export: 0 credits (free)
 *
 * Pricing tiers (Stripe):
 *   - Starter:  500 credits  — $4.99
 *   - Standard: 2,000 credits — $14.99
 *   - Pro:      5,000 credits — $29.99
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./db");

// Credit costs
const COSTS = {
  research: 10,
  refine: 5,
  merge: 5,
  publish: 0,
  export: 0,
};

// Pricing tiers
const TIERS = [
  { id: "starter", name: "Starter", credits: 500, price: 499, display: "$4.99" },
  { id: "standard", name: "Standard", credits: 2000, price: 1499, display: "$14.99" },
  { id: "pro", name: "Pro", credits: 5000, price: 2999, display: "$29.99" },
];

function getBalance(userId) {
  const db = getDb();
  const user = db.prepare("SELECT credits FROM users WHERE id=?").get(userId);
  return user ? user.credits : 0;
}

function hasCredits(userId, operation) {
  const cost = COSTS[operation] || 0;
  if (cost === 0) return true;
  return getBalance(userId) >= cost;
}

function deductCredits(userId, operation, referenceId = null) {
  const cost = COSTS[operation] || 0;
  if (cost === 0) return { cost: 0, balance: getBalance(userId) };

  const db = getDb();
  const user = db.prepare("SELECT credits FROM users WHERE id=?").get(userId);
  if (!user || user.credits < cost) {
    throw Object.assign(
      new Error(`Insufficient credits. Need ${cost}, have ${user ? user.credits : 0}.`),
      { status: 402 }
    );
  }

  const newBalance = user.credits - cost;
  db.prepare("UPDATE users SET credits=?, updated_at=datetime('now') WHERE id=?").run(
    newBalance,
    userId
  );

  db.prepare(
    "INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, reference_id) VALUES (?,?,?,?,?,?,?)"
  ).run(
    uuidv4().slice(0, 12),
    userId,
    -cost,
    newBalance,
    "deduction",
    `${operation} query`,
    referenceId
  );

  return { cost, balance: newBalance };
}

function addCredits(userId, amount, type, description, referenceId = null) {
  const db = getDb();
  const user = db.prepare("SELECT credits FROM users WHERE id=?").get(userId);
  if (!user) throw new Error("User not found");

  const newBalance = user.credits + amount;
  db.prepare("UPDATE users SET credits=?, updated_at=datetime('now') WHERE id=?").run(
    newBalance,
    userId
  );

  db.prepare(
    "INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, reference_id) VALUES (?,?,?,?,?,?,?)"
  ).run(uuidv4().slice(0, 12), userId, amount, newBalance, type, description, referenceId);

  return { balance: newBalance };
}

function getTransactions(userId, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit);
}

module.exports = {
  COSTS,
  TIERS,
  getBalance,
  hasCredits,
  deductCredits,
  addCredits,
  getTransactions,
};
