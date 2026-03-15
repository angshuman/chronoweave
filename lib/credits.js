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
const { get, run, all } = require("./db");

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

async function getBalance(userId) {
  const user = await get("SELECT credits FROM users WHERE id=?", [userId]);
  return user ? user.credits : 0;
}

async function hasCredits(userId, operation) {
  const cost = COSTS[operation] || 0;
  if (cost === 0) return true;
  return (await getBalance(userId)) >= cost;
}

async function deductCredits(userId, operation, referenceId = null) {
  const cost = COSTS[operation] || 0;
  if (cost === 0) return { cost: 0, balance: await getBalance(userId) };

  const user = await get("SELECT credits FROM users WHERE id=?", [userId]);
  if (!user || user.credits < cost) {
    throw Object.assign(
      new Error(`Insufficient credits. Need ${cost}, have ${user ? user.credits : 0}.`),
      { status: 402 }
    );
  }

  const newBalance = user.credits - cost;
  await run("UPDATE users SET credits=?, updated_at=datetime('now') WHERE id=?", [
    newBalance,
    userId,
  ]);

  await run(
    "INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, reference_id) VALUES (?,?,?,?,?,?,?)",
    [uuidv4().slice(0, 12), userId, -cost, newBalance, "deduction", `${operation} query`, referenceId]
  );

  return { cost, balance: newBalance };
}

async function addCredits(userId, amount, type, description, referenceId = null) {
  const user = await get("SELECT credits FROM users WHERE id=?", [userId]);
  if (!user) throw new Error("User not found");

  const newBalance = user.credits + amount;
  await run("UPDATE users SET credits=?, updated_at=datetime('now') WHERE id=?", [
    newBalance,
    userId,
  ]);

  await run(
    "INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, reference_id) VALUES (?,?,?,?,?,?,?)",
    [uuidv4().slice(0, 12), userId, amount, newBalance, type, description, referenceId]
  );

  return { balance: newBalance };
}

async function getTransactions(userId, limit = 50) {
  return all(
    "SELECT * FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );
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
