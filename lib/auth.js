/**
 * ChronoWeave -- Authentication (Google OAuth + JWT sessions)
 *
 * Flow:
 *  1. Frontend loads Google Identity Services (GSI) and gets an ID token
 *  2. Frontend POSTs the ID token to /api/auth/google
 *  3. Backend verifies token with google-auth-library, creates/finds user
 *  4. Backend returns a JWT + user object; frontend stores JWT in localStorage
 *  5. Subsequent API calls include Authorization: Bearer <jwt>
 *
 * Guest mode: If no auth header, requests still work but are "anonymous."
 * Credit-consuming operations (research) require auth.
 */

const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { get, run } = require("./db");

// -- Config ----------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const JWT_SECRET = process.env.JWT_SECRET || "chronoweave-dev-secret-change-me";
const JWT_EXPIRY = "30d";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// -- Google token verification --------------------------------------------

async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    google_id: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
  };
}

// -- User CRUD ------------------------------------------------------------

async function findOrCreateUser({ google_id, email, name, picture }) {
  let user = await get("SELECT * FROM users WHERE google_id=?", [google_id]);

  if (!user) {
    const id = uuidv4().slice(0, 12);
    await run(
      "INSERT INTO users (id, google_id, email, name, picture, credits) VALUES (?,?,?,?,?,1000)",
      [id, google_id, email, name, picture]
    );
    user = await get("SELECT * FROM users WHERE id=?", [id]);

    // Record the initial credit grant
    await run(
      "INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description) VALUES (?,?,?,?,?,?)",
      [uuidv4().slice(0, 12), id, 1000, 1000, "grant", "Welcome bonus — 1,000 free credits"]
    );
  } else {
    // Update profile info on each login
    await run(
      "UPDATE users SET email=?, name=?, picture=?, updated_at=datetime('now') WHERE id=?",
      [email, name, picture, user.id]
    );
    user = await get("SELECT * FROM users WHERE id=?", [user.id]);
  }

  return user;
}

async function getUserById(userId) {
  return get("SELECT * FROM users WHERE id=?", [userId]);
}

// -- JWT ------------------------------------------------------------------

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// -- Express middleware ----------------------------------------------------

/**
 * Extracts user from Authorization header or query param. Sets req.user if valid.
 * Does NOT reject unauthenticated requests — individual routes decide.
 */
async function authMiddleware(req, _res, next) {
  let token = null;
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }
  if (token) {
    const decoded = verifyJwt(token);
    if (decoded) {
      req.user = await getUserById(decoded.sub);
    }
  }
  next();
}

/**
 * Rejects requests without valid auth.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ detail: "Authentication required" });
  }
  next();
}

// -- Route handler: POST /api/auth/google ---------------------------------

async function handleGoogleLogin(req, res) {
  const { token: idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ detail: "Missing Google ID token" });
  }

  try {
    const profile = await verifyGoogleToken(idToken);
    const user = await findOrCreateUser(profile);
    const jwtToken = signToken(user);

    return res.json({
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        credits: user.credits,
      },
    });
  } catch (err) {
    console.error("Google auth failed:", err.message);
    return res.status(401).json({ detail: "Invalid Google token" });
  }
}

// -- Route handler: GET /api/auth/me --------------------------------------

function handleGetMe(req, res) {
  if (!req.user) {
    return res.json({ user: null });
  }
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      credits: req.user.credits,
    },
  });
}

module.exports = {
  authMiddleware,
  requireAuth,
  handleGoogleLogin,
  handleGetMe,
  getUserById,
  verifyJwt,
  GOOGLE_CLIENT_ID,
};
