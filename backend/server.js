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

app.get("/api/health", (_req, res) => res.json({
  ok: true, service: "jpn-api", version: "1.1.0", timestamp: new Date().toISOString()
}));

async function requireUser(req, res, next) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in is required." });
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    if (error || !data.user) return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    req.user = data.user;
    req.isAdmin = data.user.app_metadata?.role === "admin";
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

async function getEntitlement(req) {
  if (req.isAdmin) return { paid: true, expires_at: null, admin_override: true };
  const { data, error } = await req.userSupabase.from("jpn_entitlements")
    .select("paid,expires_at,updated_at").eq("user_id", req.user.id).maybeSingle();
  if (error) throw error;
  const active = !!data?.paid && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now());
  return { paid: active, expires_at: data?.expires_at || null, updated_at: data?.updated_at || null, admin_override: false };
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "JPN administrator access is required." });
  next();
}

app.get("/api/me", requireUser, async (req, res) => {
  let entitlement = { paid: false, expires_at: null };
  try { entitlement = await getEntitlement(req); }
  catch (error) { console.error("Entitlement read failed:", error.message); }
  res.json({ user: {
    id: req.user.id, email: req.user.email || null,
    created_at: req.user.created_at || null,
    last_sign_in_at: req.user.last_sign_in_at || null,
    email_confirmed_at: req.user.email_confirmed_at || null,
    role: req.isAdmin ? "admin" : "member",
    entitlement
  }});
});

app.get("/api/profile", requireUser, async (req, res) => {
  const { data, error } = await req.userSupabase.from("jpn_profiles")
    .select("id, display_name, created_at, updated_at").eq("id", req.user.id).maybeSingle();
  if (error) {
    console.error("Profile read failed:", error.message);
    return res.status(500).json({ error: "Could not load profile. Confirm the profile migration is installed." });
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
    return res.status(500).json({ error: "Could not save profile. Confirm the profile migration and RLS policies are installed." });
  }
  res.json({ profile: data });
});

app.get("/api/entitlement", requireUser, async (req, res) => {
  try { res.json({ entitlement: await getEntitlement(req), role: req.isAdmin ? "admin" : "member" }); }
  catch (error) {
    console.error("Entitlement read failed:", error.message);
    res.status(500).json({ error: "Could not check membership. Confirm the entitlement migration is installed." });
  }
});

app.get("/api/downloads", requireUser, async (req, res) => {
  try {
    const entitlement = await getEntitlement(req);
    if (!entitlement.paid) return res.status(403).json({ error: "An active paid membership is required to access downloads.", code: "PAID_MEMBERSHIP_REQUIRED" });
    const { data, error } = await req.userSupabase.from("jpn_downloads")
      .select("id,title,description,version,created_at").eq("published", true).order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ downloads: data || [], entitlement });
  } catch (error) {
    if (res.headersSent) return;
    console.error("Download list failed:", error.message);
    res.status(500).json({ error: "Could not load downloads. Confirm backend/sql/002_entitlements_and_downloads.sql has been run." });
  }
});

app.post("/api/downloads/:id/url", requireUser, async (req, res) => {
  try {
    const entitlement = await getEntitlement(req);
    if (!entitlement.paid) return res.status(403).json({ error: "An active paid membership is required to download files.", code: "PAID_MEMBERSHIP_REQUIRED" });
    const { data: item, error } = await req.userSupabase.from("jpn_downloads")
      .select("id,title,bucket,object_path,published").eq("id", req.params.id).eq("published", true).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: "Download not found." });
    const { data, error: storageError } = await req.userSupabase.storage.from(item.bucket).createSignedUrl(item.object_path, 60);
    if (storageError) throw storageError;
    res.json({ url: data.signedUrl, expires_in: 60, title: item.title });
  } catch (error) {
    console.error("Signed download URL failed:", error.message);
    res.status(500).json({ error: "Could not prepare this download. Confirm the private file and download record exist." });
  }
});

app.get("/api/admin/users", requireUser, requireAdmin, async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (email.length < 3 || email.length > 254) return res.status(400).json({ error: "Enter at least 3 characters of an email address." });
  const { data, error } = await req.userSupabase.rpc("jpn_admin_search_users", { search_email: email });
  if (error) {
    console.error("Admin user search failed:", error.message);
    return res.status(500).json({ error: error.message.includes("Admin access required") ? "Admin role is not configured correctly." : "Could not search accounts. Run the entitlements migration." });
  }
  res.json({ users: data || [] });
});

app.patch("/api/admin/users/:id/entitlement", requireUser, requireAdmin, async (req, res) => {
  const userId = String(req.params.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ error: "A valid account ID is required." });
  }
  if (typeof req.body?.paid !== "boolean") return res.status(400).json({ error: "paid must be true or false." });
  let expiresAt = null;
  if (req.body.expires_at !== undefined && req.body.expires_at !== null && req.body.expires_at !== "") {
    expiresAt = new Date(req.body.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return res.status(400).json({ error: "Expiry must be a future date." });
    expiresAt = expiresAt.toISOString();
  }
  const { data, error } = await req.userSupabase.rpc("jpn_admin_set_paid", {
    target_user_id: userId, enable_paid: req.body.paid, entitlement_expires_at: expiresAt
  });
  if (error) {
    console.error("Admin entitlement update failed:", error.message);
    return res.status(500).json({ error: error.message.includes("Admin access required") ? "Admin role is not configured correctly." : "Could not update membership. Run the entitlements migration." });
  }
  res.json({ entitlement: data?.[0] || null });
});

app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  if (err && /CORS/i.test(err.message || "")) return res.status(403).json({ error: "This website is not allowed to call the JPN API." });
  console.error("Unhandled request error:", err && err.message ? err.message : err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});
app.listen(PORT, "0.0.0.0", () => console.log("JPN API listening on port " + PORT));
