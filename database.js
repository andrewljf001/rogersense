/* ============================================================
   rogersense — Cloudflare D1 access layer (HTTP REST API)
   The VPS process talks to D1 over Cloudflare's REST endpoint,
   so no Workers binding is required.
   ============================================================ */
require('dotenv').config();

// Node 18+ has global fetch; fall back to node-fetch if absent.
const fetchFn = global.fetch || require('node-fetch');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DB_ID      = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CF_API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DB_ID}/query`;

/**
 * Run a SQL statement against D1.
 * Accepts Postgres-style `$1` placeholders (auto-rewritten to `?`) or `?` directly.
 * @returns {Promise<{rows: object[], rowCount: number}>}
 */
async function query(sql, params = []) {
  const d1sql = sql.replace(/\$(\d+)/g, '?');
  const res = await fetchFn(BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: d1sql, params }),
  });
  const data = await res.json();
  if (!data.success) {
    const errMsg = data.errors?.[0]?.message || JSON.stringify(data.errors);
    throw new Error(errMsg);
  }
  const result = data.result?.[0];
  return {
    rows: result?.results || [],
    rowCount: result?.meta?.changes || 0,
  };
}

async function initDB() {
  if (!CF_ACCOUNT_ID || !CF_DB_ID || !CF_API_TOKEN) {
    console.warn('⚠️  Cloudflare D1 env vars not set — skipping initDB(). ' +
      'Set CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN.');
    return;
  }

  const tables = [
    // ── Users (clients + admins; role distinguishes them) ────
    // Single-track auth to match the existing frontend: an admin is
    // simply a user whose role = 'admin' (requireAdmin() in main.js).
    `CREATE TABLE IF NOT EXISTS users (
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
    )`,

    // ── Project briefs (quotes) ──────────────────────────────
    `CREATE TABLE IF NOT EXISTS quotes (
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
    )`,

    // ── Message thread per brief ─────────────────────────────
    `CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      quote_id    TEXT NOT NULL,
      author_id   TEXT,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      attachments TEXT DEFAULT '[]',
      created_at  TEXT DEFAULT (datetime('now'))
    )`,

    // ── Portfolio cases ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS cases (
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
    )`,

    // ── Key-value settings ───────────────────────────────────
    `CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT DEFAULT '',
      description TEXT,
      updated_at  TEXT DEFAULT (datetime('now'))
    )`,
  ];

  const defaultSettings = [
    ['brand_name',           'rogersense',  'Public brand name (replaces [BRAND])'],
    ['company_name',         'rogersense',  'Company display name in nav/footer'],
    ['contact_email',        '',            'Admin notification email'],
    ['forum_url',            '',            'Forum URL (forum.[BRAND].com)'],
    ['github_oauth_enabled', 'false',       'Enable GitHub OAuth login'],
    ['mail_driver',          'smtp',        'Mail driver: smtp or resend'],
    ['mail_from',            '',            'Sender email address'],
    ['mail_from_name',       'rogersense',  'Sender display name'],
    ['smtp_host',            '',            'SMTP server hostname'],
    ['smtp_port',            '587',         'SMTP port'],
    ['smtp_secure',          'false',       'SMTP SSL (true/false)'],
    ['smtp_user',            '',            'SMTP username'],
    ['smtp_pass_enc',        '',            'SMTP password (AES-256-GCM encrypted)'],
    ['resend_api_key_enc',   '',            'Resend API key (encrypted)'],
  ];

  for (const sql of tables) {
    await query(sql);
  }

  for (const [key, value, description] of defaultSettings) {
    await query(
      `INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)`,
      [key, value, description]
    );
  }

  // Idempotent migrations — safe to run on every boot.
  try { await query(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'client'`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN reset_token TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN reset_token_expires TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE quotes ADD COLUMN quoted_price REAL`); } catch (e) {}

  // Seed a default admin user if none exists.
  const { rows } = await query(`SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'`);
  if (!rows[0] || rows[0].cnt === 0) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const defaultPass = process.env.DEFAULT_ADMIN_PASSWORD || 'rogersense2026';
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@rogersense.com';
    const hash = await bcrypt.hash(defaultPass, 12);
    await query(
      `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, email_verified)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [uuidv4(), defaultEmail, hash, 'rogersense Admin', 'admin']
    );
    console.log(`✅ Default admin created: ${defaultEmail} / ${defaultPass}  (change this immediately)`);
  }

  console.log('✅ D1 Database ready.');
}

// initDB() is invoked explicitly by server.js on boot (not on import).
module.exports = { query, initDB };
