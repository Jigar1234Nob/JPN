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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY. Configure backend/.env.");
  process.exit(1);
}
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const adminAuthClient = SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
}) : null;
const allowedOrigins = (process.env.FRONTEND_ORIGINS ||
  "https://jigar1234nob.github.io,http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map(value => value.trim()).filter(Boolean);

const GMAIL_SMTP_USER = process.env.GMAIL_SMTP_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const JPN_NOTIFICATION_EMAIL = process.env.JPN_NOTIFICATION_EMAIL;
const nodemailer = require("nodemailer");

const gmailTransport = GMAIL_SMTP_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: GMAIL_SMTP_USER,
        pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "")
      }
    })
  : null;

async function sendGmailEmail({ to, subject, text }) {
  if (!gmailTransport || !GMAIL_SMTP_USER) {
    console.warn("Gmail email skipped: configure GMAIL_SMTP_USER and GMAIL_APP_PASSWORD.");
    return { sent: false, reason: "not_configured" };
  }
  try {
    const result = await gmailTransport.sendMail({
      from: { name: "JPN", address: GMAIL_SMTP_USER },
      to,
      subject,
      text
    });
    return { sent: true, id: result.messageId || null };
  } catch (error) {
    console.error("Gmail SMTP email failed:", error.message);
    return { sent: false, reason: "provider_error" };
  }
}


app.disable("x-powered-by");
// Render terminates HTTPS in front of this service and forwards client IPs.
// Trust one proxy hop so express-rate-limit can identify clients correctly.
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  methods: ["GET", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 600
}));
app.use(express.json({ limit: "20kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));

const authEmailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

function requireGmailEmail(res) {
  if (!gmailTransport || !GMAIL_SMTP_USER) {
    res.status(503).json({ error: "JPN email delivery is not configured yet. Configure the Gmail SMTP variables in Render." });
    return false;
  }
  return true;
}

app.post("/api/auth/signup", authEmailLimiter, async (req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Account creation is temporarily unavailable." });
  if (!requireGmailEmail(res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const terms = req.body?.terms;
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Use a password between 8 and 128 characters." });
  if (!terms || terms.accepted !== true) return res.status(400).json({ error: "You must accept the Terms of Service before creating an account." });

  try {
    const { data, error } = await adminAuthClient.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        redirectTo: "https://jigar1234nob.github.io/JPN/dashboard/?welcome=1",
        data: {
          jpn_terms_accepted_at: String(terms.acceptedAt || new Date().toISOString()),
          jpn_terms_version: "2026-10-22",
          jpn_terms_ip_vpn_acknowledged: true
        }
      }
    });
    if (error || !data?.properties?.action_link) {
      const duplicate = /already|registered|exists/i.test(error?.message || "");
      return res.status(duplicate ? 409 : 400).json({
        error: duplicate ? "An account may already exist for that email address. Try signing in or resetting your password." : "Could not create the account. Check the details and try again."
      });
    }

    const sent = await sendGmailEmail({
      to: email,
      subject: "Confirm your JPN email address",
      text: [
        "Welcome to JPN.",
        "",
        "Confirm your email address by opening this link:",
        data.properties.action_link,
        "",
        "If you did not request a JPN account, you can ignore this email."
      ].join("\n")
    });
    if (!sent.sent) {
      if (data.user?.id) {
        const { error: cleanupError } = await adminAuthClient.auth.admin.deleteUser(data.user.id);
        if (cleanupError) console.error("Could not clean up an unconfirmed account after email failure:", cleanupError.message);
      }
      return res.status(503).json({ error: "JPN created no active account because the confirmation email could not be sent. Check the Render email settings and try again." });
    }
    return res.status(201).json({ message: "Account created. Check your inbox and spam folder for the JPN confirmation email." });
  } catch (error) {
    console.error("JPN signup failed:", error.message);
    return res.status(500).json({ error: "Could not create your account right now." });
  }
});

app.post("/api/auth/password-reset", authEmailLimiter, async (req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Password recovery is temporarily unavailable." });
  if (!requireGmailEmail(res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

  try {
    const { data, error } = await adminAuthClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: "https://jigar1234nob.github.io/JPN/login/" }
    });
    // Use a generic response for unknown accounts to avoid exposing which addresses are registered.
    if (error || !data?.properties?.action_link) {
      if (error && !/not found|no user|user not found/i.test(error.message || "")) {
        console.error("Password reset link generation failed:", error.message);
      }
      return res.json({ message: "If an account exists for that address, a password reset email will be sent." });
    }

    const sent = await sendGmailEmail({
      to: email,
      subject: "Reset your JPN password",
      text: [
        "A password reset was requested for your JPN account.",
        "",
        "Use this link to choose a new password:",
        data.properties.action_link,
        "",
        "If you did not request this, you can ignore this email."
      ].join("\n")
    });
    if (!sent.sent) return res.status(503).json({ error: "The password reset email could not be sent. Check JPN's Render email settings and try again." });
    return res.json({ message: "If an account exists for that address, a password reset email will be sent." });
  } catch (error) {
    console.error("JPN password reset failed:", error.message);
    return res.status(500).json({ error: "Could not request a password reset right now." });
  }
});

app.get("/api/health", (_req, res) => res.json({
  ok: true, service: "jpn-api", version: "1.3.0", features: ["admin-invitations", "tier-management", "account-suspension", "resource-groups", "enterprise-inquiries"], timestamp: new Date().toISOString()
}));

async function requireUser(req, res, next) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in is required." });
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    if (error || !data.user) return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    req.user = data.user;
    if (data.user.app_metadata?.jpn_disabled === true || (data.user.banned_until && new Date(data.user.banned_until).getTime() > Date.now())) {
      return res.status(403).json({ error: "This JPN account is disabled. Contact JPN support if you believe this is a mistake.", code: "ACCOUNT_DISABLED" });
    }
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
    .select("paid,plan,expires_at,updated_at").eq("user_id", req.user.id).maybeSingle();
  if (error) throw error;
  const active = !!data?.paid && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now());
  return { paid: active, plan: data?.plan || (data?.paid ? "basic" : "free"), expires_at: data?.expires_at || null, updated_at: data?.updated_at || null, admin_override: false };
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
    return res.status(500).json({ error: "Could not load your profile right now." });
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
    return res.status(500).json({ error: "Could not save your profile right now." });
  }
  res.json({ profile: data });
});

app.get("/api/entitlement", requireUser, async (req, res) => {
  try { res.json({ entitlement: await getEntitlement(req), role: req.isAdmin ? "admin" : "member" }); }
  catch (error) {
    console.error("Entitlement read failed:", error.message);
    res.status(500).json({ error: "Could not verify membership right now." });
  }
});

app.get("/api/downloads", requireUser, async (req, res) => {
  try {
    const entitlement = await getEntitlement(req);
    if (!entitlement.admin_override && (!entitlement.paid || !["premium", "enterprise"].includes(String(entitlement.plan || "").toLowerCase()))) return res.status(403).json({ error: "Downloads require an active Premium or Enterprise membership.", code: "PREMIUM_MEMBERSHIP_REQUIRED" });
    const { data, error } = await req.userSupabase.from("jpn_downloads")
      .select("id,title,description,version,group_id,github_url,created_at").eq("published", true).order("created_at", { ascending: false });
    if (error) throw error;
    const { data: groups, error: groupError } = await req.userSupabase.from("jpn_download_groups")
      .select("id,name,description,sort_order").eq("published", true).order("sort_order", { ascending: true });
    if (groupError) throw groupError;
    const visibleGroupIds = new Set((groups || []).map(group => group.id));
    const visibleDownloads = (data || []).filter(item => !item.group_id || visibleGroupIds.has(item.group_id));
    res.json({ downloads: visibleDownloads, groups: groups || [], entitlement });
  } catch (error) {
    if (res.headersSent) return;
    console.error("Download list failed:", error.message);
    res.status(500).json({ error: "Could not load downloads right now." });
  }
});

app.post("/api/downloads/:id/url", requireUser, async (req, res) => {
  try {
    const entitlement = await getEntitlement(req);
    if (!entitlement.admin_override && (!entitlement.paid || !["premium", "enterprise"].includes(String(entitlement.plan || "").toLowerCase()))) return res.status(403).json({ error: "Downloads require an active Premium or Enterprise membership.", code: "PREMIUM_MEMBERSHIP_REQUIRED" });
    const { data: item, error } = await req.userSupabase.from("jpn_downloads")
      .select("id,title,bucket,object_path,github_url,published").eq("id", req.params.id).eq("published", true).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: "Download not found." });
    if (item.github_url) {
      let parsed;
      try { parsed = new URL(item.github_url); } catch { return res.status(500).json({ error: "This release link is not configured correctly." }); }
      if (parsed.protocol !== "https:" || !["github.com", "githubusercontent.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(parsed.hostname) && !parsed.hostname.endsWith(".githubusercontent.com")) return res.status(500).json({ error: "This release link is not configured correctly." });
      return res.json({ url: parsed.toString(), expires_in: null, title: item.title, external: true });
    }
    const { data, error: storageError } = await req.userSupabase.storage.from(item.bucket).createSignedUrl(item.object_path, 60);
    if (storageError) throw storageError;
    res.json({ url: data.signedUrl, expires_in: 60, title: item.title });
  } catch (error) {
    console.error("Signed download URL failed:", error.message);
    res.status(500).json({ error: "Could not prepare this download right now." });
  }
});

app.post("/api/inquiries/enterprise", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const organization = String(req.body?.organization || "").trim();
  const message = String(req.body?.message || "").trim();
  if (name.length < 1 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      organization.length > 160 || message.length < 10 || message.length > 4000) {
    return res.status(400).json({ error: "Check the required fields and try again." });
  }
  try {
    const { error } = await authClient.from("jpn_enterprise_inquiries").insert({ name, email, organization, message });
    if (error) throw error;

    // Persist the inquiry first. Email delivery is best-effort so a temporary
    // Gmail SMTP outage never loses a customer's submitted request.
    if (GMAIL_SMTP_USER && GMAIL_APP_PASSWORD && JPN_NOTIFICATION_EMAIL) {
      const adminText = [
        "A new JPN Enterprise inquiry was submitted.",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        `Organization: ${organization || "Not provided"}`,
        "",
        "Message:",
        message
      ].join("\n");
      await sendGmailEmail({
        to: JPN_NOTIFICATION_EMAIL,
        subject: "New JPN Enterprise inquiry",
        text: adminText
      });
      await sendGmailEmail({
        to: email,
        subject: "We received your JPN Enterprise inquiry",
        text: [
          `Hi ${name},`,
          "",
          "Thanks for contacting JPN about Enterprise. We have received your inquiry for manual review.",
          "The JPN team aims to contact you by email within 3–5 business days.",
          "",
          "This is an inquiry only. It does not activate a membership or trigger a payment.",
          "",
          "JPN · J-Private-Networking Group"
        ].join("\n")
      });
    } else {
      console.warn("Enterprise inquiry saved, but Gmail SMTP email notifications are not configured.");
    }
    return res.status(201).json({ message: "Your Enterprise inquiry has been received. The JPN team can review it and contact you." });
  } catch (error) {
    console.error("Enterprise inquiry submission failed:", error.message);
    return res.status(500).json({ error: "Your inquiry could not be submitted right now. Please try again later." });
  }
});

app.patch("/api/admin/users/:id/plan", requireUser, requireAdmin, async (req, res) => {
  const userId = String(req.params.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return res.status(400).json({ error: "A valid account ID is required." });
  const plan = String(req.body?.plan || "").toLowerCase();
  if (!["free", "basic", "premium", "enterprise"].includes(plan)) return res.status(400).json({ error: "Choose Free, Basic, Premium, or Enterprise." });
  let expiresAt = null;
  if (req.body.expires_at) {
    const date = new Date(req.body.expires_at);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return res.status(400).json({ error: "Expiry must be a future date." });
    expiresAt = date.toISOString();
  }
  const { data, error } = await req.userSupabase.rpc("jpn_admin_set_plan", { target_user_id: userId, target_plan: plan, entitlement_expires_at: expiresAt });
  if (error) {
    console.error("Admin plan update failed:", error.message);
    return res.status(500).json({ error: error.message.includes("Admin access required") ? "Admin access could not be verified." : "Could not update the membership plan. Contact the site administrator if this continues." });
  }
  res.json({ entitlement: data?.[0] || null });
});

app.patch("/api/admin/users/:id/disabled", requireUser, requireAdmin, async (req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Account controls are temporarily unavailable. Contact the site administrator." });
  const userId = String(req.params.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return res.status(400).json({ error: "A valid account ID is required." });
  if (userId === req.user.id) return res.status(400).json({ error: "You cannot disable your own administrator account." });
  if (typeof req.body?.disabled !== "boolean") return res.status(400).json({ error: "Choose whether the account should be enabled or disabled." });
  try {
    const { data: current, error: lookupError } = await adminAuthClient.auth.admin.getUserById(userId);
    if (lookupError || !current?.user) return res.status(404).json({ error: "Account not found." });
    if (current.user.app_metadata?.role === "admin" && req.body.disabled) return res.status(400).json({ error: "Administrator accounts cannot be disabled from this screen." });
    const appMetadata = { ...(current.user.app_metadata || {}), jpn_disabled: req.body.disabled };
    const { error } = await adminAuthClient.auth.admin.updateUserById(userId, {
      ban_duration: req.body.disabled ? "876000h" : "none",
      app_metadata: appMetadata
    });
    if (error) throw error;
    res.json({ disabled: req.body.disabled, message: req.body.disabled ? "Account disabled. New sign-ins and protected API access are blocked." : "Account enabled again." });
  } catch (error) {
    console.error("Admin account suspension failed:", error.message);
    res.status(500).json({ error: "Could not change account status. Check the backend account-control configuration." });
  }
});

app.get("/api/admin/download-groups", requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await req.userSupabase.from("jpn_download_groups").select("id,name,description,sort_order,published").order("sort_order", { ascending: true });
  if (error) { console.error("Admin groups read failed:", error.message); return res.status(500).json({ error: "Could not load download groups right now." }); }
  res.json({ groups: data || [] });
});
app.post("/api/admin/download-groups", requireUser, requireAdmin, async (req, res) => {
  const name = String(req.body?.name || "").trim(), description = String(req.body?.description || "").trim();
  const sort_order = Number.isInteger(req.body?.sort_order) ? req.body.sort_order : 0;
  if (!name || name.length > 80 || description.length > 500) return res.status(400).json({ error: "Group name is required (80 characters max); description must be 500 characters or fewer." });
  const { data, error } = await req.userSupabase.from("jpn_download_groups").insert({ name, description, sort_order, published: true }).select("id,name,description,sort_order,published").single();
  if (error) { console.error("Admin group create failed:", error.message); return res.status(500).json({ error: "Could not create the group right now." }); }
  res.status(201).json({ group: data });
});
app.patch("/api/admin/download-groups/:id", requireUser, requireAdmin, async (req, res) => {
  const patch = {};
  if (typeof req.body?.name === "string" && req.body.name.trim() && req.body.name.trim().length <= 80) patch.name = req.body.name.trim();
  if (typeof req.body?.description === "string" && req.body.description.length <= 500) patch.description = req.body.description.trim();
  if (typeof req.body?.published === "boolean") patch.published = req.body.published;
  if (Number.isInteger(req.body?.sort_order)) patch.sort_order = req.body.sort_order;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid group changes were provided." });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await req.userSupabase.from("jpn_download_groups").update(patch).eq("id", req.params.id).select("id,name,description,sort_order,published").maybeSingle();
  if (error || !data) { console.error("Admin group update failed:", error?.message); return res.status(500).json({ error: "Could not update this group." }); }
  res.json({ group: data });
});
app.delete("/api/admin/download-groups/:id", requireUser, requireAdmin, async (req, res) => {
  const { error } = await req.userSupabase.from("jpn_download_groups").delete().eq("id", req.params.id);
  if (error) { console.error("Admin group delete failed:", error.message); return res.status(500).json({ error: "Could not delete this group." }); }
  res.json({ success: true });
});
app.get("/api/admin/downloads", requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await req.userSupabase.from("jpn_downloads").select("id,title,description,version,group_id,github_url,published,created_at").order("created_at", { ascending: false });
  if (error) { console.error("Admin downloads read failed:", error.message); return res.status(500).json({ error: "Could not load release builds right now." }); }
  res.json({ downloads: data || [] });
});
app.post("/api/admin/downloads", requireUser, requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim(), description = String(req.body?.description || "").trim();
  const version = String(req.body?.version || "").trim(), group_id = String(req.body?.group_id || "");
  const github_url = String(req.body?.github_url || "").trim();
  const id = String(req.body?.id || title.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")).slice(0,80);
  let parsed;
  try { parsed = new URL(github_url); } catch { return res.status(400).json({ error: "Enter a valid HTTPS GitHub release or asset URL." }); }
  if (parsed.protocol !== "https:" || !(parsed.hostname === "github.com" || parsed.hostname.endsWith(".githubusercontent.com") || parsed.hostname === "objects.githubusercontent.com" || parsed.hostname === "release-assets.githubusercontent.com")) return res.status(400).json({ error: "Build URLs must point to GitHub over HTTPS." });
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id) || !title || title.length > 120 || description.length > 1000 || version.length > 40) return res.status(400).json({ error: "Check the build title, version, description, and ID." });
  const { data: group, error: groupError } = await req.userSupabase.from("jpn_download_groups").select("id").eq("id", group_id).maybeSingle();
  if (groupError || !group) return res.status(400).json({ error: "Choose a valid download group." });
  const { data, error } = await req.userSupabase.from("jpn_downloads").insert({ id, title, description, version, group_id, github_url: parsed.toString(), object_path: null, published: true }).select("id,title,description,version,group_id,github_url,published").single();
  if (error) { console.error("Admin build create failed:", error.message); return res.status(500).json({ error: "Could not publish this build right now." }); }
  res.status(201).json({ download: data });
});
app.patch("/api/admin/downloads/:id", requireUser, requireAdmin, async (req, res) => {
  const patch = {};
  if (typeof req.body?.published === "boolean") patch.published = req.body.published;
  if (typeof req.body?.title === "string" && req.body.title.trim() && req.body.title.trim().length <= 120) patch.title = req.body.title.trim();
  if (typeof req.body?.description === "string" && req.body.description.length <= 1000) patch.description = req.body.description.trim();
  if (typeof req.body?.version === "string" && req.body.version.length <= 40) patch.version = req.body.version.trim();
  if (typeof req.body?.group_id === "string") patch.group_id = req.body.group_id || null;
  if (typeof req.body?.github_url === "string") {
    try { const parsed = new URL(req.body.github_url); if (parsed.protocol !== "https:" || !(parsed.hostname === "github.com" || parsed.hostname.endsWith(".githubusercontent.com") || parsed.hostname === "objects.githubusercontent.com" || parsed.hostname === "release-assets.githubusercontent.com")) throw new Error(); patch.github_url = parsed.toString(); }
    catch { return res.status(400).json({ error: "Build URLs must point to GitHub over HTTPS." }); }
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid build changes were provided." });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await req.userSupabase.from("jpn_downloads").update(patch).eq("id", req.params.id).select("id,title,description,version,group_id,github_url,published").maybeSingle();
  if (error || !data) { console.error("Admin build update failed:", error?.message); return res.status(500).json({ error: "Could not update this build." }); }
  res.json({ download: data });
});
app.delete("/api/admin/downloads/:id", requireUser, requireAdmin, async (req, res) => {
  const { error } = await req.userSupabase.from("jpn_downloads").delete().eq("id", req.params.id);
  if (error) { console.error("Admin build delete failed:", error.message); return res.status(500).json({ error: "Could not remove this build." }); }
  res.json({ success: true });
});
app.patch("/api/admin/enterprise-inquiries/:id", requireUser, requireAdmin, async (req, res) => {
  const status = String(req.body?.status || "");
  if (!["new", "contacted", "closed"].includes(status)) return res.status(400).json({ error: "Choose a valid inquiry status." });
  const { data, error } = await req.userSupabase.from("jpn_enterprise_inquiries").update({ status }).eq("id", req.params.id).select("id,status").maybeSingle();
  if (error || !data) { console.error("Enterprise inquiry update failed:", error?.message); return res.status(500).json({ error: "Could not update this inquiry." }); }
  res.json({ inquiry: data });
});
app.get("/api/admin/enterprise-inquiries", requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await req.userSupabase.from("jpn_enterprise_inquiries").select("id,name,email,organization,message,status,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) { console.error("Enterprise inquiries read failed:", error.message); return res.status(500).json({ error: "Could not load Enterprise inquiries." }); }
  res.json({ inquiries: data || [] });
});

app.post("/api/auth/change-email", requireUser, authEmailLimiter, async (req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Email changes are temporarily unavailable." });
  if (!requireGmailEmail(res)) return;
  const currentEmail = String(req.user.email || "").trim().toLowerCase();
  const newEmail = String(req.body?.email || "").trim().toLowerCase();
  if (!currentEmail || !validEmail(newEmail)) return res.status(400).json({ error: "Enter a valid new email address." });
  if (currentEmail === newEmail) return res.status(400).json({ error: "That is already your account email address." });

  try {
    const [currentResult, newResult] = await Promise.all([
      adminAuthClient.auth.admin.generateLink({
        type: "email_change_current",
        email: currentEmail,
        newEmail,
        options: { redirectTo: "https://jigar1234nob.github.io/JPN/dashboard/" }
      }),
      adminAuthClient.auth.admin.generateLink({
        type: "email_change_new",
        email: currentEmail,
        newEmail,
        options: { redirectTo: "https://jigar1234nob.github.io/JPN/dashboard/" }
      })
    ]);
    if (currentResult.error || newResult.error ||
        !currentResult.data?.properties?.action_link || !newResult.data?.properties?.action_link) {
      console.error("Email change link generation failed:", currentResult.error?.message || newResult.error?.message || "Missing action link");
      return res.status(400).json({ error: "Could not start the email change. Check that secure email change is enabled in Supabase Auth settings." });
    }

    const [currentSent, newSent] = await Promise.all([
      sendGmailEmail({
        to: currentEmail,
        subject: "Confirm your JPN email change",
        text: [
          "A request was made to change your JPN account email to " + newEmail + ".",
          "",
          "Confirm that you requested this change:",
          currentResult.data.properties.action_link,
          "",
          "If you did not request this, ignore this email and do not confirm the change."
        ].join("\n")
      }),
      sendGmailEmail({
        to: newEmail,
        subject: "Confirm your new JPN email for JPN",
        text: [
          "A request was made to use this address for a JPN account.",
          "",
          "Confirm the new email address:",
          newResult.data.properties.action_link,
          "",
          "If you did not request this, ignore this email."
        ].join("\n")
      })
    ]);
    if (!currentSent.sent || !newSent.sent) {
      return res.status(503).json({ error: "One or both confirmation emails could not be sent. Check Render's Gmail SMTP settings before requesting the change again." });
    }
    return res.json({ message: "Confirmation links were sent to your current and new email addresses. Confirm both to finish the change." });
  } catch (error) {
    console.error("JPN email change failed:", error.message);
    return res.status(500).json({ error: "Could not request an email change right now." });
  }
});

app.post("/api/admin/users/invite", requireUser, requireAdmin, async (req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Account invitations are temporarily unavailable. Please try again later." });
  if (!requireGmailEmail(res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  try {
    const { data, error } = await adminAuthClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: "https://jigar1234nob.github.io/JPN/invitation/" }
    });
    if (error || !data?.properties?.action_link) {
      const duplicate = /already|registered|exists/i.test(error?.message || "");
      return res.status(duplicate ? 409 : 400).json({ error: duplicate ? "An account already exists for that email address." : "Could not create the invitation. Check the email address and try again." });
    }
    const sent = await sendGmailEmail({
      to: email,
      subject: "You're invited to JPN",
      text: [
        "You have been invited to create your JPN account.",
        "",
        "Open this link to accept the invitation and set your password:",
        "https://jigar1234nob.github.io/JPN/invitation/?token_hash=" + encodeURIComponent(data.properties.hashed_token) + "&type=invite",
        "",
        "If you were not expecting this invitation, you can ignore this email."
      ].join("\n")
    });
    if (!sent.sent) {
      if (data.user?.id) {
        const { error: cleanupError } = await adminAuthClient.auth.admin.deleteUser(data.user.id);
        if (cleanupError) console.error("Could not clean up an invited account after email failure:", cleanupError.message);
      }
      return res.status(503).json({ error: "The invitation email could not be sent. Check Render's Gmail SMTP settings and try again." });
    }
    return res.status(201).json({ user: { id: data.user?.id || null, email: data.user?.email || email }, message: "Invitation sent through JPN email delivery." });
  } catch (error) {
    console.error("Admin invitation failed:", error.message);
    return res.status(500).json({ error: "Could not create the account invitation." });
  }
});

app.get("/api/admin/plan-requests", requireUser, requireAdmin, async (_req, res) => {
  if (!adminAuthClient) return res.status(503).json({ error: "Plan requests are temporarily unavailable because administrator account access is not configured." });
  try {
    const requests = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await adminAuthClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data?.users || [];
      for (const user of users) {
        const metadata = user.user_metadata || {};
        const plan = String(metadata.jpn_plan_request || "").toLowerCase();
        const status = String(metadata.jpn_plan_request_status || "pending").toLowerCase();
        if (["basic", "premium", "enterprise"].includes(plan)) {
          requests.push({
            user_id: user.id,
            email: user.email || null,
            plan,
            status,
            requested_at: metadata.jpn_plan_requested_at || user.created_at || null
          });
        }
      }
      if (users.length < 1000) break;
    }
    requests.sort((a, b) => new Date(b.requested_at || 0).getTime() - new Date(a.requested_at || 0).getTime());
    res.json({ requests: requests.slice(0, 100) });
  } catch (error) {
    console.error("Admin plan requests read failed:", error.message);
    res.status(500).json({ error: "Could not load the latest plan requests right now." });
  }
});

app.get("/api/admin/users", requireUser, requireAdmin, async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (email.length < 3 || email.length > 254) return res.status(400).json({ error: "Enter at least 3 characters of an email address." });
  const { data, error } = await req.userSupabase.rpc("jpn_admin_search_users", { search_email: email });
  if (error) {
    console.error("Admin user search failed:", error.message);
    return res.status(500).json({ error: error.message.includes("Admin access required") ? "Administrator access could not be verified." : "Could not search accounts right now." });
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
  const { data, error } = await req.userSupabase.rpc("jpn_admin_set_plan", {
    target_user_id: userId, target_plan: req.body.paid ? "basic" : "free", entitlement_expires_at: expiresAt
  });
  if (error) {
    console.error("Admin entitlement update failed:", error.message);
    return res.status(500).json({ error: error.message.includes("Admin access required") ? "Administrator access could not be verified." : "Could not update membership right now." });
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
