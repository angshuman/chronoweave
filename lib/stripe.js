/**
 * ChronoWeave -- Stripe integration
 *
 * Handles checkout session creation and webhook processing.
 * Uses Stripe Checkout (hosted) for PCI compliance simplicity.
 */

const { v4: uuidv4 } = require("uuid");
const { get, run } = require("./db");
const { addCredits, TIERS } = require("./credits");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const APP_URL = process.env.APP_URL || "http://localhost:8000";

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
    }
    const Stripe = require("stripe");
    _stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
  }
  return _stripe;
}

// -- Get or create Stripe customer ----------------------------------------

async function getOrCreateStripeCustomer(userId) {
  const existing = await get("SELECT stripe_customer_id FROM stripe_customers WHERE user_id=?", [userId]);
  if (existing) return existing.stripe_customer_id;
  return null; // Will be created during checkout
}

async function saveStripeCustomer(userId, stripeCustomerId) {
  await run(
    "INSERT OR REPLACE INTO stripe_customers (user_id, stripe_customer_id) VALUES (?,?)",
    [userId, stripeCustomerId]
  );
}

// -- Create checkout session ----------------------------------------------

async function createCheckoutSession(userId, tierId) {
  const stripe = getStripe();
  const user = await get("SELECT * FROM users WHERE id=?", [userId]);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const tier = TIERS.find((t) => t.id === tierId);
  if (!tier) throw Object.assign(new Error("Invalid tier"), { status: 400 });

  // Get or create Stripe customer
  let customerId = await getOrCreateStripeCustomer(userId);
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { chronoweave_user_id: userId },
    });
    customerId = customer.id;
    await saveStripeCustomer(userId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `ChronoWeave ${tier.name} — ${tier.credits} Credits`,
            description: `${tier.credits} research credits for ChronoWeave timeline builder`,
          },
          unit_amount: tier.price,
        },
        quantity: 1,
      },
    ],
    metadata: {
      chronoweave_user_id: userId,
      tier_id: tier.id,
      credits: String(tier.credits),
    },
    success_url: `${APP_URL}?payment=success&credits=${tier.credits}`,
    cancel_url: `${APP_URL}?payment=cancelled`,
  });

  return { url: session.url, session_id: session.id };
}

// -- Webhook handler ------------------------------------------------------

async function handleWebhook(rawBody, signature) {
  const stripe = getStripe();

  let event;
  if (STRIPE_WEBHOOK_SECRET) {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } else {
    // Dev mode: parse directly (not secure for production)
    event = JSON.parse(rawBody);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.chronoweave_user_id;
    const tierId = session.metadata?.tier_id;
    const credits = parseInt(session.metadata?.credits || "0", 10);

    if (userId && credits > 0) {
      const tier = TIERS.find((t) => t.id === tierId);
      await addCredits(
        userId,
        credits,
        "purchase",
        `Purchased ${tier ? tier.name : tierId} — ${credits} credits`,
        session.id
      );
      console.log(`[Stripe] Added ${credits} credits to user ${userId}`);
    }
  }

  return { received: true };
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  TIERS,
};
