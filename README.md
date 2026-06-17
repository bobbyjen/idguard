# IDGuard — Travel Document Expiry Tracker

Never get turned away at the airport for an expired passport or license again.
IDGuard tracks your IDs and sends email and SMS reminders well before they expire.

> ⚠️ Never commit the `secrets/` folder or `.env` file.
> All credentials are managed via Docker secrets — see deployment section.

---

## Features

- Tracks passports, driver's licenses, REAL ID, Global Entry, NEXUS, TSA PreCheck, Green Cards, and more
- Visual countdown ring per document with colour-coded urgency (green → amber → red)
- Configurable alert thresholds per document (e.g. 180, 90, 30, 7 days before expiry)
- Email alerts via Gmail (Nodemailer)
- SMS alerts via Twilio (optional)
- International travel 6-month passport validity warning
- Daily scheduler fires at 9 AM — one alert per threshold, not a daily flood
- Self-hosted on a home NAS with no recurring SaaS fees

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│               Browser (Home LAN or HTTPS)           │
│   React + htm (no build step, no Babel)             │
│   Served as static files from Express               │
└────────────────────┬────────────────────────────────┘
                     │ HTTP REST API
                     ▼
┌─────────────────────────────────────────────────────┐
│         idguard-server.js (Node.js 20)              │
│         Express 4 · port 3000                       │
│                                                     │
│  REST API:                                          │
│    GET    /api/documents       — list all           │
│    POST   /api/documents       — create             │
│    PUT    /api/documents/:id   — update             │
│    DELETE /api/documents/:id   — delete             │
│    POST   /api/documents/:id/test-alert             │
│    POST   /api/admin/run-check — manual trigger     │
│    GET    /health                                   │
│                                                     │
│  Static files:  /public/index.html + /public/app.js │
│  Scheduler:     node-cron · 9:00 AM daily           │
└──────────┬──────────────────┬───────────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌──────────────────────────────┐
│   PostgreSQL 16  │  │  Notification Services        │
│   Docker volume  │  │  · Nodemailer + Gmail SMTP    │
│                  │  │  · Twilio SMS (optional)      │
│  documents       │  └──────────────────────────────┘
│  alert_log       │
└──────────────────┘

All containers run via Docker Compose.
Credentials stored as Docker secrets (tmpfs, never written to disk).
```

---

## Deployment (Synology NAS / Docker Compose)

### 1. Prerequisites

- Synology NAS with Container Manager installed (DSM 7+)
- SSH access enabled (Control Panel → Terminal & SNMP)

### 2. Clone the repo

```bash
git clone https://github.com/bobbyjen/idguard.git
cd idguard
```

### 3. Create the secrets folder

All credentials are stored as Docker secrets — never in plain text files or environment variables.

```bash
mkdir -p secrets

# Gmail credentials (for email alerts)
echo "your.address@gmail.com"  > secrets/gmail_user.txt
echo "xxxx xxxx xxxx xxxx"     > secrets/gmail_app_password.txt  # Google App Password

# Twilio (optional — use placeholder if not configuring SMS yet)
echo "placeholder"  > secrets/twilio_sid.txt
echo "placeholder"  > secrets/twilio_token.txt
echo "placeholder"  > secrets/twilio_phone.txt

# Database and admin
openssl rand -base64 32 > secrets/db_password.txt
openssl rand -base64 32 > secrets/admin_secret.txt

chmod 600 secrets/*.txt
```

To generate a Gmail App Password: Google Account → Security → 2-Step Verification → App passwords.

### 4. Create the .env file (non-secret config only)

```bash
cat > .env << 'ENVEOF'
PORT=3000
TZ=America/Los_Angeles
FROM_EMAIL=your.address@gmail.com
ALLOWED_ORIGINS=*
ENVEOF
```

### 5. Create the data directory

```bash
mkdir -p data/postgres
```

### 6. Build and launch

```bash
sudo docker compose up -d --build
```

### 7. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## Notification Logic

### When alerts fire

Each document has an `alert_advance_days` array (e.g. `[180, 90, 30, 7]`).
The daily cron job fires an alert when `days_remaining` exactly matches one of
those thresholds. Alerts also fire on day 0 (expiry day) and day -1.
This means one alert per threshold — not a daily flood.

### Passport 6-month rule

For US passports and passport cards, IDGuard computes a travel safe window:

```
safe_travel_days = days_remaining - 180
```

Most countries require at least 6 months of passport validity beyond your
return date. The frontend and email template both surface this as a warning.

---

## API Reference

### Create a document

```http
POST /api/documents
Content-Type: application/json

{
  "holder_name": "Jane Smith",
  "doc_type": "us_passport",
  "expiry_date": "2027-03-15",
  "alert_email": "jane@example.com",
  "alert_phone": "+15551234567",
  "alert_channels": ["email", "sms"],
  "alert_advance_days": [180, 90, 30, 7],
  "notes": "Stored in fireproof safe"
}
```

### Send a test alert

```http
POST /api/documents/:id/test-alert
```

### Trigger manual daily check

```http
POST /api/admin/run-check
x-admin-secret: <value from secrets/admin_secret.txt>
```

---

## Document Types Supported

| Document         | type key           | Typical cycle  | Notes                              |
|------------------|--------------------|----------------|------------------------------------|
| US Passport      | `us_passport`      | 10 years       | 6-month travel rule applies        |
| Passport Card    | `us_passport_card` | 10 years       | 6-month travel rule; land/sea only |
| Driver's License | `drivers_license`  | 4–8 years      | Required for domestic air travel   |
| REAL ID          | `real_id`          | Same as license| Star marking; federal facilities   |
| Global Entry     | `global_entry`     | 5 years        | Includes TSA PreCheck              |
| NEXUS Card       | `nexus`            | 5 years        | Canada/US border programme         |
| TSA PreCheck     | `tsa_precheck`     | 5 years        | Expedited domestic screening       |
| Green Card / PR  | `green_card`       | 10 years       | Permanent Resident Card            |
| Military ID      | `military_id`      | Varies         |                                    |
| Other            | `other`            | —              | Generic fallback                   |

---

## Security

- **Docker secrets** — all credentials (Gmail, Twilio, DB password, admin secret) are
  mounted as tmpfs inside containers at `/run/secrets/`. Never written to disk, never
  visible in `docker inspect`.
- **Content Security Policy** — helmet enforces strict CSP. All scripts served locally
  from `/vendor/` and `/app.js` — no external CDN dependencies, no `unsafe-eval`.
- **HSTS disabled** — intentional for local HTTP deployment. Enable once HTTPS is
  configured via DSM reverse proxy + Let's Encrypt.
- **Data minimisation** — `doc_number` field is optional. No biometric data or full
  document scans are stored.
- **Admin endpoint** — `/api/admin/run-check` requires an `x-admin-secret` header
  matching the value in `secrets/admin_secret.txt`.

---

## HTTPS Setup (optional but recommended)

For external access or user authentication, set up HTTPS via DSM:

1. **DDNS** — Control Panel → External Access → DDNS → Add (Synology provider)
2. **Port forwarding** — Forward ports 80 and 443 on your router to the NAS IP
3. **Let's Encrypt** — Control Panel → Security → Certificate → Add → Let's Encrypt
4. **Reverse Proxy** — Control Panel → Login Portal → Advanced → Reverse Proxy
   - Source: `https://yourname.synology.me:443`
   - Destination: `http://localhost:3000`
5. Update `ALLOWED_ORIGINS` in `.env` to `https://yourname.synology.me`

---

## Activating SMS (Twilio)

1. Sign up at twilio.com and get an Account SID, Auth Token, and phone number
2. Replace the placeholder values:

```bash
echo "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" > secrets/twilio_sid.txt
echo "your-auth-token"                   > secrets/twilio_token.txt
echo "+15550001234"                      > secrets/twilio_phone.txt
chmod 600 secrets/twilio_*.txt
```

3. Rebuild:

```bash
sudo docker compose up -d --build
```

---

## License

MIT
