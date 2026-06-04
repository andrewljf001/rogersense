-- rogersense D1 schema (mirrors database.js initDB()).
-- Apply: wrangler d1 execute rogersense-db --remote --file=schema.sql
-- The running backend also creates these on boot; this file is for
-- provisioning/verification and as the canonical schema reference.
-- NOTE: the default admin user (bcrypt-hashed) is seeded at runtime by
-- the backend, not here.

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT,
  name                TEXT NOT NULL DEFAULT '',
  company             TEXT,
  role                TEXT DEFAULT 'client',
  github_id           TEXT,
  email_verified      INTEGER DEFAULT 0,
  verify_token        TEXT,
  reset_token         TEXT,
  reset_token_expires TEXT,
  last_login_at       TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  quote_no     TEXT UNIQUE NOT NULL,
  user_id      TEXT,
  guest_email  TEXT,
  disciplines  TEXT DEFAULT '[]',
  deliverable  TEXT,
  description  TEXT,
  files        TEXT DEFAULT '[]',
  status       TEXT DEFAULT 'pending',
  quoted_price REAL,
  admin_note   TEXT,
  name         TEXT,
  email        TEXT,
  company      TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  quote_id    TEXT NOT NULL,
  author_id   TEXT,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases (
  id          TEXT PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT,
  tags        TEXT DEFAULT '[]',
  description TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  images      TEXT DEFAULT '[]',
  published   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT DEFAULT '',
  description TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('brand_name',           'rogersense',  'Public brand name (replaces [BRAND])'),
  ('company_name',         'rogersense',  'Company display name in nav/footer'),
  ('contact_email',        '',            'Admin notification email'),
  ('forum_url',            '',            'Forum URL (forum.[BRAND].com)'),
  ('github_oauth_enabled', 'false',       'Enable GitHub OAuth login'),
  ('mail_driver',          'smtp',        'Mail driver: smtp or resend'),
  ('mail_from',            '',            'Sender email address'),
  ('mail_from_name',       'rogersense',  'Sender display name'),
  ('smtp_host',            '',            'SMTP server hostname'),
  ('smtp_port',            '587',         'SMTP port'),
  ('smtp_secure',          'false',       'SMTP SSL (true/false)'),
  ('smtp_user',            '',            'SMTP username'),
  ('smtp_pass_enc',        '',            'SMTP password (AES-256-GCM encrypted)'),
  ('resend_api_key_enc',   '',            'Resend API key (encrypted)');
