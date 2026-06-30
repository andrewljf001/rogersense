/* ============================================================
   rogersense — Cloudflare D1 access layer (HTTP REST API)
   The VPS process talks to D1 over Cloudflare's REST endpoint,
   so no Workers binding is required.
   ============================================================ */
require('dotenv').config();

const crypto = require('crypto');

// Node 18+ has global fetch; fall back to node-fetch if absent.
const fetchFn = global.fetch || require('node-fetch');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DB_ID      = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CF_API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DB_ID}/query`;

// ── Driver selection ────────────────────────────────────────
// Production: Cloudflare D1 over HTTP. Local dev / automated tests:
// better-sqlite3 (D1 *is* SQLite, so this is a faithful test double).
// Opt in with DB_DRIVER=sqlite (SQLITE_PATH optional, default in-memory).
const USE_SQLITE = process.env.DB_DRIVER === 'sqlite';

let sqliteDb = null;
function getSqlite() {
  if (sqliteDb) return sqliteDb;
  const { DatabaseSync } = require('node:sqlite');   // built-in, no native build
  sqliteDb = new DatabaseSync(process.env.SQLITE_PATH || ':memory:');
  return sqliteDb;
}
const IS_READ = /^\s*(select|pragma|with)\b/i;

/**
 * Run a SQL statement.
 * Accepts Postgres-style `$1` placeholders (auto-rewritten to `?`) or `?`.
 * @returns {Promise<{rows: object[], rowCount: number}>}
 */
async function query(sql, params = []) {
  const sqlQ = sql.replace(/\$(\d+)/g, '?');

  if (USE_SQLITE) {
    const stmt = getSqlite().prepare(sqlQ);
    if (IS_READ.test(sqlQ)) {
      return { rows: stmt.all(...params), rowCount: 0 };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: Number(info.changes) };
  }

  const res = await fetchFn(BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: sqlQ, params }),
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
  if (!USE_SQLITE && (!CF_ACCOUNT_ID || !CF_DB_ID || !CF_API_TOKEN)) {
    console.warn('⚠️  Cloudflare D1 env vars not set — skipping initDB(). ' +
      'Set CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN ' +
      '(or DB_DRIVER=sqlite for local).');
    return;
  }

  const tables = [
    // ── Users (clients + admins; role distinguishes them) ────
    // Single-track auth to match the existing frontend: an admin is
    // simply a user whose role = 'admin' (requireAdmin() in main.js).
    `CREATE TABLE IF NOT EXISTS users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE NOT NULL,
      password_hash         TEXT,
      name                  TEXT NOT NULL DEFAULT '',
      company               TEXT,
      whatsapp              TEXT,
      role                  TEXT DEFAULT 'client',
      customer_type         TEXT DEFAULT 'normal',
      note                  TEXT,
      github_id             TEXT,
      email_verified        INTEGER DEFAULT 0,
      verify_token          TEXT,
      reset_token           TEXT,
      reset_token_expires   TEXT,
      deletion_requested_at TEXT,
      deletion_reason       TEXT,
      last_login_at         TEXT,
      created_at            TEXT DEFAULT (datetime('now')),
      updated_at            TEXT DEFAULT (datetime('now'))
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
      shipping_fee REAL,
      total_paid   REAL DEFAULT 0,
      payment_intent TEXT,
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

    // ── Products (dev boards & tools — fixed price, direct buy) ─
    `CREATE TABLE IF NOT EXISTS products (
      id           TEXT PRIMARY KEY,
      slug         TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      category     TEXT DEFAULT 'board',
      price        REAL NOT NULL DEFAULT 0,
      currency     TEXT DEFAULT 'USD',
      stock        INTEGER DEFAULT 0,
      summary      TEXT DEFAULT '',
      description  TEXT DEFAULT '',
      cover_image  TEXT DEFAULT '',
      images       TEXT DEFAULT '[]',
      downloads    TEXT DEFAULT '[]',
      status       TEXT DEFAULT 'active',
      sort_order   INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    )`,

    // ── Product orders (direct purchases of the above) ───────
    `CREATE TABLE IF NOT EXISTS product_orders (
      id             TEXT PRIMARY KEY,
      order_no       TEXT UNIQUE NOT NULL,
      product_id     TEXT NOT NULL,
      product_name   TEXT,
      user_id        TEXT,
      buyer_email    TEXT,
      buyer_name     TEXT,
      qty            INTEGER DEFAULT 1,
      unit_price     REAL,
      total_paid     REAL DEFAULT 0,
      ship_recipient TEXT,
      ship_phone     TEXT,
      ship_address   TEXT,
      ship_city      TEXT,
      ship_country   TEXT DEFAULT 'US',
      status         TEXT DEFAULT 'pending',
      payment_intent TEXT,
      tracking_no    TEXT,
      carrier        TEXT,
      admin_note     TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    )`,

    // ── Product reviews ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS product_reviews (
      id          TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL,
      author_name TEXT NOT NULL,
      email       TEXT,
      rating      INTEGER DEFAULT 5,
      comment     TEXT DEFAULT '',
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now'))
    )`,

    // ── Customer shipping/billing addresses ──────────────────
    `CREATE TABLE IF NOT EXISTS addresses (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      label        TEXT DEFAULT 'Home',
      recipient    TEXT,
      phone        TEXT,
      address_line TEXT,
      city         TEXT,
      country      TEXT DEFAULT 'US',
      is_default   INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    )`,

    // ── Blog posts ───────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS posts (
      id           TEXT PRIMARY KEY,
      slug         TEXT UNIQUE NOT NULL,
      title        TEXT NOT NULL,
      excerpt      TEXT DEFAULT '',
      content      TEXT DEFAULT '',
      cover_url    TEXT DEFAULT '',
      tags         TEXT DEFAULT '[]',
      status       TEXT DEFAULT 'draft',
      author       TEXT DEFAULT 'Rogersense Team',
      views        INTEGER DEFAULT 0,
      published_at TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
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
    ['contact_address',      '',            'Address shown on Contact page'],
    ['contact_hours',        'Mon–Sat, 9am–6pm', 'Business hours shown on Contact page'],
    ['whatsapp_number',      '',            'WhatsApp contact number (digits only, no + sign)'],
    ['engineer_whatsapp',    '',            'Engineer direct WhatsApp (digits only, no + sign)'],
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
    ['paypal_client_id',     '',            'PayPal Client ID'],
    ['paypal_client_secret_enc', '',        'PayPal Client Secret (encrypted)'],
    ['paypal_mode',          'live',        'PayPal mode: live or sandbox'],
    ['turnstile_site_key',   '',            'Cloudflare Turnstile site key (public)'],
    ['turnstile_secret_enc', '',            'Cloudflare Turnstile secret (encrypted)'],
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
  try { await query(`ALTER TABLE users ADD COLUMN customer_type TEXT DEFAULT 'normal'`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN note TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN whatsapp TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN deletion_requested_at TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE users ADD COLUMN deletion_reason TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE quotes ADD COLUMN quoted_price REAL`); } catch (e) {}
  try { await query(`ALTER TABLE quotes ADD COLUMN shipping_fee REAL`); } catch (e) {}
  try { await query(`ALTER TABLE quotes ADD COLUMN total_paid REAL DEFAULT 0`); } catch (e) {}
  try { await query(`ALTER TABLE quotes ADD COLUMN payment_intent TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE product_orders ADD COLUMN tracking_no TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE product_orders ADD COLUMN carrier TEXT`); } catch (e) {}
  try { await query(`ALTER TABLE product_orders ADD COLUMN admin_note TEXT`); } catch (e) {}

  // Seed a default admin user (role-based) if none exists.
  const { rows } = await query(`SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'`);
  if (!rows[0] || rows[0].cnt === 0) {
    const bcrypt = require('bcryptjs');
    const defaultPass  = process.env.DEFAULT_ADMIN_PASSWORD || 'rogersense2026';
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@rogersense.com';
    const hash = await bcrypt.hash(defaultPass, 12);
    await query(
      `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, email_verified)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [crypto.randomUUID(), defaultEmail, hash, 'rogersense Admin', 'admin']
    );
    console.log(`✅ Default admin created: ${defaultEmail} / ${defaultPass}  (change this immediately)`);
  }

  console.log('✅ D1 Database ready.');
}

// initDB() is invoked explicitly by server.js on boot (not on import).
module.exports = { query, initDB };
