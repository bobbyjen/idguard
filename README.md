# IDGuard — Travel Document Expiry Tracker

Never get turned away at the airport for an expired passport or license again.
IDGuard tracks your IDs and sends email/SMS reminders well before they expire.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                      Frontend                       │
│  React SPA (IDGuard.jsx)                            │
│  • Add/edit/delete documents                        │
│  • Visual countdown rings per document              │
│  • Alert channel config (email + SMS)               │
│  • Persistent storage (window.storage / localStorage)│
└────────────────────┬────────────────────────────────┘
                     │ REST API (JSON)
                     ▼
┌─────────────────────────────────────────────────────┐
│                  idguard-server.js                  │
│  Express + Node.js                                  │
│                                                     │
│  Routes:                                            │
│    GET    /api/documents       — list all           │
│    POST   /api/documents       — create             │
│    PUT    /api/documents/:id   — update             │
│    DELETE /api/documents/:id   — delete             │
│    POST   /api/documents/:id/test-alert             │
│    POST   /api/admin/run-check — manual trigger     │
│    GET    /health                                   │
│                                                     │
│  Daily Cron (9 AM):                                 │
│    → Query documents expiring at configured windows │
│    → Send email via SendGrid                        │
│    → Send SMS via Twilio                            │
│    → Log results to alert_log table                 │
└────────────────┬───────────────────────────────────┘
                 │
       ┌─────────┴────────┐
       ▼                  ▼
┌──────────────┐   ┌─────────────────────────────────┐
│  PostgreSQL  │   │  Notification Services           │
│  schema.sql  │   │  • SendGrid  → HTML email        │
│              │   │  • Twilio    → SMS               │
│  documents   │   └─────────────────────────────────┘
│  alert_log   │
└──────────────┘
```

---

## Quick Start

### 1. Clone and install dependencies

```bash
git clone <your-repo>
cd idguard
npm install
```

### 2. Set up PostgreSQL

```bash
# Create the database
createdb idguard

# Run the schema
psql idguard -f schema.sql
```

### 3. Configure environment variables

Create a `.env` file:

```env
DATABASE_URL=postgresql://localhost:5432/idguard
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxx
FROM_EMAIL=alerts@yourdomain.com

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15550001234

ADMIN_SECRET=your-secret-key-here
PORT=3000
TZ=America/New_York
```

### 4. Run the server

```bash
# Development
node idguard-server.js

# Production (with PM2)
pm2 start idguard-server.js --name idguard
pm2 save
pm2 startup
```

---

## Notification Logic

### When alerts fire
Each document has an `alert_advance_days` array (e.g. `[180, 90, 30, 7]`).
The daily cron job fires an alert whenever **today's day count matches
one of those thresholds**. Example: if a passport expires in exactly 90 days,
the 90-day alert is sent.

Additionally, alerts fire on day 0 (expiry day) and day -1 (one day after expiry).

### International travel — the 6-month rule
For passports, IDGuard also computes a "travel safe" window:
```
safe_travel_days = days_remaining - 180
```
Most countries require at least 6 months of passport validity beyond
your return date. The frontend surfaces this as a secondary warning.

---

## API Reference

### Create a document
```http
POST /api/documents
Content-Type: application/json

{
  "holder_name": "Jane Smith",
  "doc_type": "us_passport",
  "expiry_date": "2026-03-15",
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
x-admin-secret: your-secret-key-here
```

---

## Deployment

### Railway (recommended for simplicity)
```bash
railway login
railway init
railway add --database postgresql
railway up
```

Set the env vars in the Railway dashboard. Railway provides
`DATABASE_URL` automatically when you add the PostgreSQL plugin.

### Render
1. Create a new Web Service pointing to your repo.
2. Set build command: `npm install`
3. Set start command: `node idguard-server.js`
4. Add a PostgreSQL database from Render's dashboard.
5. Set all env vars in the Render dashboard.

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json .
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "idguard-server.js"]
```

---

## Document Types Supported

| ID                 | type key            | Notes                          |
|--------------------|---------------------|--------------------------------|
| US Passport        | `us_passport`       | 6-month travel rule applies    |
| Passport Card      | `us_passport_card`  | 6-month travel rule applies    |
| Driver's License   | `drivers_license`   | State-issued, 4–8 year cycle   |
| REAL ID            | `real_id`           | Required for domestic air travel|
| Global Entry       | `global_entry`      | 5-year renewal                 |
| NEXUS Card         | `nexus`             | 5-year renewal                 |
| TSA PreCheck       | `tsa_precheck`      | 5-year renewal                 |
| Green Card / PR    | `green_card`        | 10-year renewal                |
| Military ID        | `military_id`       |                                |
| Other              | `other`             |                                |

---

## Security Notes

- **Never store full document numbers** unless you encrypt them at rest.
  The `doc_number` field is optional for this reason.
- Use HTTPS in production (Render, Railway both provide this automatically).
- Rotate your `ADMIN_SECRET` regularly.
- Consider adding user authentication (Clerk, Auth0, or custom JWT)
  to scope documents per user in a multi-tenant deployment.
- SendGrid and Twilio API keys should have the minimum required permissions.

---

## License

MIT
