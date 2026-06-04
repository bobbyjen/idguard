-- IDGuard Database Schema
-- Run: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Documents Table ───────────────────────────────────────────────────────────
-- Each row is one tracked ID document for one person.

CREATE TABLE IF NOT EXISTS documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document identity
  holder_name       TEXT        NOT NULL,
  doc_type          TEXT        NOT NULL,   -- 'us_passport', 'drivers_license', etc.
  doc_number        TEXT,                   -- optional, stored unencrypted — omit if privacy is critical
  expiry_date       DATE        NOT NULL,

  -- Alert configuration
  alert_email       TEXT,                   -- where to send email reminders
  alert_phone       TEXT,                   -- E.164 format, e.g. +15551234567
  alert_channels    JSONB       NOT NULL DEFAULT '["email"]',
                                            -- e.g. ["email", "sms"]
  alert_advance_days JSONB      NOT NULL DEFAULT '[180, 90, 30, 7]',
                                            -- days before expiry to trigger alerts

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Alert Log Table ───────────────────────────────────────────────────────────
-- Audit trail of every alert sent. Used to avoid duplicate sends.

CREATE TABLE IF NOT EXISTS alert_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  days_remaining INTEGER     NOT NULL,
  channels_used  JSONB,                  -- {"email": "sent", "sms": "sent"}
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_test        BOOLEAN     NOT NULL DEFAULT FALSE
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup of documents expiring soon (used by daily scheduler)
CREATE INDEX IF NOT EXISTS idx_documents_expiry
  ON documents (expiry_date ASC);

-- Alert history per document
CREATE INDEX IF NOT EXISTS idx_alert_log_document
  ON alert_log (document_id, sent_at DESC);

-- ─── Updated-at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Sample Data (delete before production) ────────────────────────────────────

-- INSERT INTO documents (holder_name, doc_type, expiry_date, alert_email, alert_advance_days)
-- VALUES
--   ('Jane Smith',  'us_passport',      '2025-03-15', 'jane@example.com', '[180,90,30,7]'),
--   ('Jane Smith',  'drivers_license',  '2026-08-20', 'jane@example.com', '[90,30,7]'),
--   ('John Smith',  'us_passport',      '2027-11-01', 'john@example.com', '[180,90,30]');
