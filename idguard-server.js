/**
 * IDGuard Backend Server
 * Express + PostgreSQL + Nodemailer (Gmail) + Twilio + node-cron
 *
 * npm install express pg nodemailer twilio node-cron dotenv cors helmet
 */

require("dotenv").config();
const fs         = require("fs");
const path       = require("path");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const { Pool }   = require("pg");
const nodemailer = require("nodemailer");
const twilio     = require("twilio");
const cron       = require("node-cron");

// ─── Secret Helper ────────────────────────────────────────────────────────────
// Reads from Docker secrets (/run/secrets/<name>) first,
// falls back to environment variable if the file doesn't exist.

function secret(name, envFallback) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, "utf8").trim();
  } catch {
    return process.env[envFallback || name.toUpperCase()];
  }
}

// ─── Field Parser ─────────────────────────────────────────────────────────────
// PostgreSQL JSONB columns are already parsed by the pg driver into JS arrays.
// This handles both that case and raw JSON strings gracefully.

function parseField(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch { return fallback; }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: `postgresql://idguard:${secret("db_password","DB_PASSWORD")}@db:5432/idguard`,
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: secret("gmail_user",         "GMAIL_USER"),
    pass: secret("gmail_app_password", "GMAIL_APP_PASSWORD"),
  },
});

// Twilio is initialized lazily so placeholder values don't crash the server.
function getSmsClient() {
  const sid   = secret("twilio_sid",   "TWILIO_ACCOUNT_SID");
  const token = secret("twilio_token", "TWILIO_AUTH_TOKEN");
  if (!sid || !token || sid === "placeholder" || token === "placeholder") return null;
  return twilio(sid, token);
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(helmet({
  // Disable HSTS — this server runs on HTTP on a home LAN.
  // HSTS would tell browsers to always use HTTPS, causing connection failures.
  hsts: false,
  // Disable COOP — not meaningful on a local HTTP origin and causes console noise.
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],                                                  // all scripts served locally from /vendor/ and /app.js
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      connectSrc:  ["'self'"],
      imgSrc:      ["'self'", "data:"],
    },
  },
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Database Helper ──────────────────────────────────────────────────────────

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── Document CRUD ────────────────────────────────────────────────────────────

// GET /api/documents
app.get("/api/documents", async (req, res) => {
  try {
    const { rows } = await query("SELECT * FROM documents ORDER BY expiry_date ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents
app.post("/api/documents", async (req, res) => {
  const {
    holder_name, doc_type, doc_number, expiry_date,
    alert_email, alert_phone, alert_channels, alert_advance_days, notes,
  } = req.body;

  if (!holder_name || !doc_type || !expiry_date) {
    return res.status(400).json({ error: "holder_name, doc_type, and expiry_date are required" });
  }

  try {
    const { rows } = await query(
      `INSERT INTO documents
         (holder_name, doc_type, doc_number, expiry_date,
          alert_email, alert_phone, alert_channels, alert_advance_days, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        holder_name, doc_type, doc_number || null, expiry_date,
        alert_email || null, alert_phone || null,
        JSON.stringify(alert_channels || ["email"]),
        JSON.stringify(alert_advance_days || [180, 90, 30, 7]),
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/documents/:id
app.put("/api/documents/:id", async (req, res) => {
  const { id } = req.params;
  const {
    holder_name, doc_type, doc_number, expiry_date,
    alert_email, alert_phone, alert_channels, alert_advance_days, notes,
  } = req.body;

  try {
    const { rows } = await query(
      `UPDATE documents SET
         holder_name=$1, doc_type=$2, doc_number=$3, expiry_date=$4,
         alert_email=$5, alert_phone=$6, alert_channels=$7,
         alert_advance_days=$8, notes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        holder_name, doc_type, doc_number || null, expiry_date,
        alert_email || null, alert_phone || null,
        JSON.stringify(alert_channels || ["email"]),
        JSON.stringify(alert_advance_days || [180, 90, 30, 7]),
        notes || null, id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id
app.delete("/api/documents/:id", async (req, res) => {
  try {
    await query("DELETE FROM documents WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/test-alert
app.post("/api/documents/:id/test-alert", async (req, res) => {
  try {
    const { rows } = await query("SELECT * FROM documents WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const results = await sendAlerts(rows[0], true);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notification Logic ───────────────────────────────────────────────────────

const DOC_TYPE_LABELS = {
  us_passport:      "US Passport",
  us_passport_card: "Passport Card",
  drivers_license:  "Driver's License",
  real_id:          "REAL ID",
  global_entry:     "Global Entry Card",
  nexus:            "NEXUS Card",
  tsa_precheck:     "TSA PreCheck",
  green_card:       "Green Card / Permanent Resident Card",
  military_id:      "Military ID",
  other:            "ID Document",
};

function daysUntilExpiry(expiryDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  return Math.floor((exp - now) / 86400000);
}

function urgencyLabel(days) {
  if (days < 0)   return "EXPIRED";
  if (days <= 7)  return "URGENT";
  if (days <= 30) return "CRITICAL";
  if (days <= 90) return "WARNING";
  return "NOTICE";
}

function emailHtml(doc, days) {
  const label      = DOC_TYPE_LABELS[doc.doc_type] || "ID Document";
  const exp        = new Date(doc.expiry_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const urgency    = urgencyLabel(days);
  const color      = days < 30 ? "#ef4444" : days < 90 ? "#f59e0b" : "#3b82f6";
  const isPassport = doc.doc_type === "us_passport" || doc.doc_type === "us_passport_card";
  const travelSafe = isPassport ? days - 180 : null;
  const advDays    = parseField(doc.alert_advance_days, []).join("d, ");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
      <tr><td style="background:#080c18;padding:28px 36px">
        <div style="font-family:'Georgia',serif;font-size:26px;color:#d4a843;font-weight:600;letter-spacing:-0.5px">IDGuard</div>
        <div style="color:rgba(255,255,255,0.5);font-size:13px;margin-top:4px">Travel Document Alert</div>
      </td></tr>
      <tr><td style="padding:32px 36px">
        <div style="background:${color}12;border:1px solid ${color}30;border-radius:10px;padding:14px 18px;margin-bottom:28px;display:inline-block">
          <span style="font-family:'Courier New',monospace;font-size:11px;font-weight:600;letter-spacing:2px;color:${color}">${urgency}</span>
        </div>
        <h1 style="font-family:'Georgia',serif;font-size:26px;color:#111827;margin:0 0 8px;font-weight:600">
          ${days < 0 ? "Your document has expired" : `${label} expiring ${days <= 30 ? "very soon" : "soon"}`}
        </h1>
        <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 28px">
          ${doc.holder_name}'s ${label} ${days < 0 ? `expired <strong>${Math.abs(days)} days ago</strong>` : `expires in <strong>${days} day${days !== 1 ? "s" : ""}</strong>`} on <strong>${exp}</strong>.
        </p>
        ${travelSafe !== null ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:28px">
          <div style="font-size:13px;font-weight:600;color:#1d4ed8;margin-bottom:4px">✈️ International Travel Notice</div>
          <div style="font-size:13px;color:#1e40af;line-height:1.5">
            ${travelSafe > 0
              ? `This passport is safe for international travel for approximately <strong>${travelSafe} more days</strong>. Many countries require 6 months of remaining validity.`
              : "This passport no longer meets the 6-month validity requirement for most international destinations. Renew before traveling abroad."}
          </div>
        </div>` : ""}
        <div style="background:#f9fafb;border-radius:10px;padding:18px;margin-bottom:28px">
          <table width="100%" cellpadding="4" cellspacing="0" style="font-size:13px">
            <tr><td style="color:#9ca3af;width:140px">Document type</td><td style="color:#111827;font-weight:500">${label}</td></tr>
            <tr><td style="color:#9ca3af">Holder</td><td style="color:#111827;font-weight:500">${doc.holder_name}</td></tr>
            <tr><td style="color:#9ca3af">Expiry date</td><td style="color:${color};font-weight:600">${exp}</td></tr>
            <tr><td style="color:#9ca3af">Days remaining</td><td style="color:${color};font-weight:600">${days < 0 ? "Expired" : days}</td></tr>
          </table>
        </div>
        <div style="text-align:center;margin-bottom:20px">
          <a href="https://travel.state.gov/content/travel/en/passports/need-passport/renew-adult.html"
            style="background:#111827;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:600;display:inline-block">
            Start Renewal Process →
          </a>
        </div>
      </td></tr>
      <tr><td style="padding:20px 36px;border-top:1px solid #f3f4f6;background:#fafafa">
        <p style="font-size:12px;color:#9ca3af;margin:0;line-height:1.6">
          This reminder was sent by IDGuard. You configured alerts ${advDays}d before expiry.<br>
          To update your preferences, visit your IDGuard dashboard.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendAlerts(doc, isTest = false) {
  const days     = daysUntilExpiry(doc.expiry_date);
  const label    = DOC_TYPE_LABELS[doc.doc_type] || "ID Document";
  const channels = parseField(doc.alert_channels, ["email"]);
  const results  = { email: null, sms: null };

  // Email via Gmail
  if (channels.includes("email") && doc.alert_email) {
    try {
      await transporter.sendMail({
        from:    `"IDGuard" <${secret("gmail_user", "GMAIL_USER")}>`,
        to:      doc.alert_email,
        subject: `${isTest ? "[TEST] " : ""}${days < 0 ? "EXPIRED" : `Expiring in ${days} days`}: ${doc.holder_name}'s ${label}`,
        html:    emailHtml(doc, days),
      });
      results.email = "sent";
    } catch (err) {
      results.email = `error: ${err.message}`;
    }
  }

  // SMS via Twilio (skipped gracefully if not configured)
  if (channels.includes("sms") && doc.alert_phone) {
    const smsClient = getSmsClient();
    if (!smsClient) {
      results.sms = "skipped: Twilio not configured";
    } else {
      const expStr = new Date(doc.expiry_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const body = days < 0
        ? `IDGuard: ${doc.holder_name}'s ${label} EXPIRED ${Math.abs(days)} days ago (${expStr}). Renew ASAP!`
        : `IDGuard: ${doc.holder_name}'s ${label} expires in ${days} day${days !== 1 ? "s" : ""} (${expStr}). Renew soon to avoid travel disruptions.`;
      try {
        await smsClient.messages.create({
          body,
          from: secret("twilio_phone", "TWILIO_PHONE_NUMBER"),
          to:   doc.alert_phone,
        });
        results.sms = "sent";
      } catch (err) {
        results.sms = `error: ${err.message}`;
      }
    }
  }

  // Log the send
  await query(
    `INSERT INTO alert_log (document_id, days_remaining, channels_used, sent_at, is_test)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [doc.id, days, JSON.stringify(results), isTest]
  ).catch(console.error);

  return results;
}

// ─── Daily Scheduler ──────────────────────────────────────────────────────────

async function runDailyCheck() {
  console.log(`[${new Date().toISOString()}] Running daily expiry check...`);
  try {
    const { rows: docs } = await query("SELECT * FROM documents");
    for (const doc of docs) {
      const days        = daysUntilExpiry(doc.expiry_date);
      const advanceDays = parseField(doc.alert_advance_days, [180, 90, 30, 7]);
      const shouldAlert = advanceDays.includes(days) || days === 0 || days === -1;
      if (shouldAlert) {
        console.log(`  → Alerting: ${doc.holder_name} (${doc.doc_type}) — ${days} days remaining`);
        const results = await sendAlerts(doc);
        console.log(`    Results:`, results);
      }
    }
    console.log(`[${new Date().toISOString()}] Daily check complete. Processed ${docs.length} documents.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Daily check failed:`, err.message);
  }
}

// Run every day at 9:00 AM
cron.schedule("0 9 * * *", runDailyCheck, {
  timezone: process.env.TZ || "America/New_York",
});

// Manual trigger (protected by admin secret)
app.post("/api/admin/run-check", async (req, res) => {
  if (req.headers["x-admin-secret"] !== secret("admin_secret", "ADMIN_SECRET")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  await runDailyCheck();
  res.json({ success: true });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`IDGuard server running on port ${PORT}`);
  console.log(`Scheduler active — daily checks at 9:00 AM ${process.env.TZ || "America/New_York"}`);
});
