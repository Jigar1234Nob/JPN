require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY. Configure backend/.env.");
  process.exit(1);
}

const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const allowedOrigins = (process.env.FRONTEND_ORIGINS ||
  "https://jigar1234nob.github.io,http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map(value => value.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  methods: ["GET", "PATCH", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 600
}));
app.use(express.json({ limit: "20kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "jpn-api", version: "1.0.0", timestamp: new Date().toISOString() });
});

async function requireUser(req, res, next) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in is required." });
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    if (error || !data.user) return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    req.user = data.user;
    // Keep database access scoped to the caller's JWT so Postgres RLS remains active.
    req.userSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: "Bearer " + match[1] } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    next();
  } catch (error) {
    console.error("Authentication check failed:", error.message);
    res.status(401).json({ error: "Could not verify your session." });
  }
}

app.get("/api/me", requireUser, (req, res) => {
  res.json({ user: {
    id: req.user.id,
    email: req.user.email || null,
    created_at: req.user.created_at || null,
    last_sign_in_at: req.user.last_sign_in_at || null,
    email_confirmed_at: req.user.email_confirmed_at || null
  }});
});

app.get("/api/profile", requireUser, async (req, res) => {
  const { data, error } = await req.userSupabase.from("jpn_profiles")
    .select("id, display_name, created_at, updated_at")
    .eq("id", req.user.id).maybeSingle();
  if (error) {
    console.error("Profile read failed:", error.message);
    return res.status(500).json({ error: "Could not load profile. Confirm the jpn_profiles table and RLS policies are installed." });
  }
  res.json({ profile: data });
});

app.patch("/api/profile", requireUser, async (req, res) => {
  const raw = req.body && req.body.display_name;
  if (typeof raw !== "string") return res.status(400).json({ error: "display_name must be a string." });
  const display_name = raw.trim();
  if (display_name.length > 80) return res.status(400).json({ error: "Display name must be 80 characters or fewer." });
  const { data, error } = await req.userSupabase.from("jpn_profiles")
    .upsert({ id: req.user.id, display_name, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("id, display_name, created_at, updated_at").single();
  if (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({ error: "Could not save profile. Confirm the database migration and RLS policies are installed." });
  }
  res.json({ profile: data });
});

app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  if (err && /CORS/i.test(err.message || "")) return res.status(403).json({ error: "This website is not allowed to call the JPN API." });
  console.error("Unhandled request error:", err && err.message ? err.message : err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(PORT, "0.0.0.0", () => console.log("JPN API listening on port " + PORT));