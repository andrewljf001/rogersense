/* ============================================================
   rogersense — API + static server
   Node.js + Express · Cloudflare D1 (HTTP) · Cloudflare R2
   Mirrors the proven sister-project architecture, adapted to
   rogersense's domain (briefs / quotes / cases / messages).
   ============================================================ */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const db = require('./database');
const fetchFn = global.fetch || require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;
const SITE_URL   = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_TTL    = '7d';
const CANONICAL_HOST = new URL(SITE_URL).hostname;

// ── AES-256-GCM for secrets at rest (SMTP pass / API keys) ───
const ENC_KEY_RAW = process.env.SETTINGS_ENCRYPT_KEY || '';
const ENC_KEY = ENC_KEY_RAW ? crypto.createHash('sha256').update(ENC_KEY_RAW).digest() : null;

function encrypt(text) {
  if (!ENC_KEY || !text) return text || '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}
function decrypt(ciphertext) {
  if (!ENC_KEY || !ciphertext) return ciphertext || '';
  try {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !encHex) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex'), null, 'utf8') + decipher.final('utf8');
  } catch { return ''; }
}

// ── Cloudflare R2 (S3-compatible) ───────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const R2_BUCKET     = process.env.R2_BUCKET || 'rogersense-files';

/** Presigned PUT URL so the browser uploads directly to R2. */
async function presignUpload(key, contentType) {
  const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' });
  return getSignedUrl(r2, cmd, { expiresIn: 600 });
}
/** Presigned GET URL for private downloads (1h). */
async function presignDownload(key) {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: 3600 });
}

// ── Mail (SMTP or Resend, config from settings table) ───────
async function getSetting(key, fallback = '') {
  try {
    const { rows } = await db.query(`SELECT value FROM settings WHERE key = ?`, [key]);
    return rows[0]?.value ?? fallback;
  } catch { return fallback; }
}
// Best-effort by default (errors are logged, not thrown). Pass
// { throwError: true } (e.g. the admin "send test" button) to surface
// configuration/transport errors to the caller instead of swallowing them.
async function sendMail({ to, subject, html }, { throwError = false } = {}) {
  try {
    const driver   = await getSetting('mail_driver', 'smtp');
    const fromAddr = (await getSetting('mail_from')) || process.env.MAIL_FROM || 'noreply@rogersense.com';
    const fromName = (await getSetting('mail_from_name')) || 'rogersense';
    const from = `${fromName} <${fromAddr}>`;
    if (driver === 'resend') {
      const apiKey = decrypt(await getSetting('resend_api_key_enc')) || process.env.RESEND_API_KEY || '';
      if (!apiKey) {
        if (throwError) throw new Error('Resend API key is not set');
        console.warn('[MAIL] resend key not set'); return;
      }
      const resp = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (throwError && !resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Resend returned ${resp.status}: ${body.slice(0, 200)}`);
      }
    } else {
      const nodemailer = require('nodemailer');
      const host = (await getSetting('smtp_host')) || process.env.SMTP_HOST || '';
      const user = (await getSetting('smtp_user')) || process.env.SMTP_USER || '';
      const pass = decrypt(await getSetting('smtp_pass_enc')) || process.env.SMTP_PASS || '';
      if (!host || !user || !pass) {
        if (throwError) throw new Error('SMTP is not configured (need host, username and password)');
        console.warn('[MAIL] SMTP not configured; skipping mail to', to); return;
      }
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt((await getSetting('smtp_port')) || '587'),
        secure: (await getSetting('smtp_secure')) === 'true',
        auth: { user, pass },
      });
      await transporter.sendMail({ from, to, subject, html });
    }
    console.log('[MAIL] sent to', to);
  } catch (err) {
    console.error('[MAIL ERROR]', err.message);
    if (throwError) throw err;
  }
}

// ── PayPal (config from settings table; secret encrypted) ───
async function getPayPalConfig() {
  const { rows } = await db.query(
    `SELECT key, value FROM settings WHERE key IN ('paypal_client_id','paypal_client_secret_enc','paypal_mode')`
  );
  const cfg = {}; rows.forEach(r => { cfg[r.key] = r.value; });
  return {
    clientId:     cfg.paypal_client_id || process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: decrypt(cfg.paypal_client_secret_enc) || process.env.PAYPAL_CLIENT_SECRET || '',
    mode:         cfg.paypal_mode || process.env.PAYPAL_MODE || 'live',
  };
}
async function getPayPalToken() {
  const { clientId, clientSecret, mode } = await getPayPalConfig();
  if (!clientId || !clientSecret) throw new Error('PayPal is not configured (need client id + secret)');
  const base = mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const res = await fetchFn(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get PayPal token: ' + JSON.stringify(data));
  return { token: data.access_token, base };
}

// ── Cloudflare Turnstile (human verification) ───────────────
// Returns true if not configured (so forms keep working until set up).
async function verifyTurnstile(token, ip) {
  const siteKey = (await getSetting('turnstile_site_key')) || '';
  const secret = decrypt(await getSetting('turnstile_secret_enc')) || process.env.TURNSTILE_SECRET || '';
  // Only enforce when BOTH keys are configured — otherwise the widget can't
  // render (no site key) and we must not lock users out of the forms.
  if (!siteKey || !secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.append('remoteip', ip);
    const r = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const d = await r.json();
    return !!d.success;
  } catch { return false; }
}

// ── Helpers ─────────────────────────────────────────────────
function genQuoteNo() {
  const n = new Date();
  const ymd = n.getFullYear().toString().slice(-2) +
              String(n.getMonth() + 1).padStart(2, '0') +
              String(n.getDate()).padStart(2, '0');
  return 'RS' + ymd + Math.random().toString(36).slice(2, 7).toUpperCase();
}
const jp = (v, dflt) => { try { return JSON.parse(v); } catch { return dflt; } };

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, company: u.company || '', role: u.role || 'client' };
}
function shapeQuote(q) {
  return {
    ...q,
    disciplines: jp(q.disciplines, []),
    files: jp(q.files, []),
  };
}
function shapeCase(c) {
  return {
    ...c,
    tags: jp(c.tags, []),
    images: jp(c.images, []),
    published: !!c.published,
  };
}
function signToken(u) {
  return jwt.sign({ id: u.id, email: u.email, role: u.role || 'client', name: u.name }, JWT_SECRET, { expiresIn: JWT_TTL });
}

// ── Auth middleware ─────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Token expired or invalid' }); }
}
/** Soft auth: populate req.user if a valid token is present, else continue. */
function softAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, JWT_SECRET); } catch {} }
  next();
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  next();
}

// ── Express setup ───────────────────────────────────────────
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.hostname === 'www.rogersense.com') {
    return res.redirect(301, `${req.protocol}://rogersense.com${req.originalUrl}`);
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Content-Security-Policy', "frame-ancestors 'self'");
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
});
const ALLOWED_ORIGINS = new Set([
  SITE_URL,
  `https://${CANONICAL_HOST}`,
  'https://rogersense.com',
  'https://www.rogersense.com',
  'https://forum.rogersense.com',
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    return cb(null, false);
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', (req, res, nxt) => { res.set('Cache-Control', 'no-store'); nxt(); });

// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!await verifyTurnstile(req.body.cf_turnstile, req.ip)) return res.status(400).json({ message: 'Human verification failed. Please try again.' });
    if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    const exists = await db.query(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ message: 'Email already registered' });
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'client')`,
      [id, email.toLowerCase(), hash, name]
    );
    const user = { id, name, email: email.toLowerCase(), company: '', role: 'client' };
    res.json({ token: signToken(user), user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!await verifyTurnstile(req.body.cf_turnstile, req.ip)) return res.status(400).json({ message: 'Human verification failed. Please try again.' });
    if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });
    const { rows } = await db.query(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()]);
    const u = rows[0];
    if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    await db.query(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [u.id]);
    res.json({ token: signToken(u), user: publicUser(u) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Forgot password — email a reset link (always returns ok to avoid email enumeration).
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email required' });
    const u = (await db.query(`SELECT id, name FROM users WHERE email = ?`, [email])).rows[0];
    if (u) {
      const token = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      await db.query(`UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?`, [token, expires, u.id]);
      const brand = (await getSetting('company_name')) || 'rogersense';
      sendMail({ to: email, subject: `[${brand}] Reset your password`,
        html: `<p>Hi ${u.name || ''},</p><p>Click below to set a new password (valid for 1 hour):</p>` +
              `<p><a href="${SITE_URL}/reset.html?token=${token}" style="background:#0d9488;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p>` +
              `<p>If you didn't request this, you can ignore this email.</p>` });
    }
    res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Reset password with a valid token.
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and new password required' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    const u = (await db.query(`SELECT id, reset_token_expires FROM users WHERE reset_token = ?`, [token])).rows[0];
    if (!u || !u.reset_token_expires || new Date(u.reset_token_expires) < new Date()) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
    }
    const hash = await bcrypt.hash(password, 12);
    await db.query(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = datetime('now') WHERE id = ?`, [hash, u.id]);
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GitHub OAuth (manual web flow) — inert until env configured.
app.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.redirect('/login.html?error=github_not_configured');
  const redirectUri = `${SITE_URL}/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}` +
              `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;
  res.redirect(url);
});
app.get('/auth/github/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) return res.redirect('/login.html?error=github_failed');
    const tokRes = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return res.redirect('/login.html?error=github_failed');
    const ghHeaders = { 'Authorization': `Bearer ${tok.access_token}`, 'User-Agent': 'rogersense', 'Accept': 'application/json' };
    const ghUser = await (await fetchFn('https://api.github.com/user', { headers: ghHeaders })).json();
    let email = ghUser.email;
    if (!email) {
      const emails = await (await fetchFn('https://api.github.com/user/emails', { headers: ghHeaders })).json();
      email = (Array.isArray(emails) && (emails.find(e => e.primary) || emails[0])?.email) || `${ghUser.id}@users.noreply.github.com`;
    }
    email = email.toLowerCase();
    let { rows } = await db.query(`SELECT * FROM users WHERE github_id = ? OR email = ?`, [String(ghUser.id), email]);
    let u = rows[0];
    if (!u) {
      const id = uuidv4();
      await db.query(
        `INSERT INTO users (id, email, name, company, role, github_id, email_verified) VALUES (?, ?, ?, '', 'client', ?, 1)`,
        [id, email, ghUser.name || ghUser.login || 'GitHub User', String(ghUser.id)]
      );
      u = { id, email, name: ghUser.name || ghUser.login, company: '', role: 'client' };
    } else if (!u.github_id) {
      await db.query(`UPDATE users SET github_id = ? WHERE id = ?`, [String(ghUser.id), u.id]);
    }
    // Hand the token to the frontend via the login page (consumed in Phase 3).
    res.redirect(`/login.html?token=${encodeURIComponent(signToken(u))}`);
  } catch (e) { res.redirect('/login.html?error=github_failed'); }
});

// ════════════════════════════════════════════════════════════
// ME
// ════════════════════════════════════════════════════════════
app.put('/auth/me', auth, async (req, res) => {
  try {
    const { name, company } = req.body;
    await db.query(`UPDATE users SET name = COALESCE(?, name), company = COALESCE(?, company), updated_at = datetime('now') WHERE id = ?`,
      [name ?? null, company ?? null, req.user.id]);
    const { rows } = await db.query(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// QUOTES (briefs)
// ════════════════════════════════════════════════════════════
app.post('/quotes', auth, async (req, res) => {
  try {
    const { disciplines = [], deliverable = 'unsure', description = '', files = [], name = '', email = '', company = '' } = req.body;
    if (!Array.isArray(disciplines) || !disciplines.length) return res.status(400).json({ message: 'Select at least one discipline' });
    if (!description.trim()) return res.status(400).json({ message: 'Description required' });
    const id = uuidv4();
    const quote_no = genQuoteNo();
    await db.query(
      `INSERT INTO quotes (id, quote_no, user_id, disciplines, deliverable, description, files, status, name, email, company)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [id, quote_no, req.user.id, JSON.stringify(disciplines), deliverable, description.trim(),
       JSON.stringify(files), name || req.user.name, email || req.user.email, company]
    );
    // Notify admin (best effort)
    const adminEmail = await getSetting('contact_email');
    if (adminEmail) sendMail({ to: adminEmail, subject: `New brief ${quote_no}`, html: `<p>New project brief <b>${quote_no}</b> from ${name || req.user.name} (${email || req.user.email}).</p><p>${description}</p>` });
    res.json({ ok: true, quote: { id, quote_no, status: 'pending' } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// List: admin sees all (optional ?status=), client sees own.
app.get('/quotes', auth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      const status = req.query.status;
      const r = status
        ? await db.query(`SELECT * FROM quotes WHERE status = ? ORDER BY created_at DESC`, [status])
        : await db.query(`SELECT * FROM quotes ORDER BY created_at DESC`);
      rows = r.rows;
    } else {
      rows = (await db.query(`SELECT * FROM quotes WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id])).rows;
    }
    res.json({ quotes: rows.map(shapeQuote) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/quotes/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM quotes WHERE id = ?`, [req.params.id]);
    const q = rows[0];
    if (!q) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'admin' && q.user_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    res.json({ quote: shapeQuote(q) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/quotes/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    await db.query(`UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: set pricing / note on a brief (needed before sending a payment link).
app.patch('/quotes/:id', auth, adminOnly, async (req, res) => {
  try {
    const f = req.body;
    const sets = [], params = [];
    if (f.quoted_price !== undefined) { sets.push(`quoted_price = ?`); params.push(f.quoted_price === '' || f.quoted_price === null ? null : Number(f.quoted_price)); }
    if (f.shipping_fee !== undefined) { sets.push(`shipping_fee = ?`); params.push(f.shipping_fee === '' || f.shipping_fee === null ? null : Number(f.shipping_fee)); }
    if (f.admin_note !== undefined)   { sets.push(`admin_note = ?`);   params.push(f.admin_note); }
    if (f.status !== undefined)       { sets.push(`status = ?`);       params.push(f.status); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = datetime('now')`);
    params.push(req.params.id);
    await db.query(`UPDATE quotes SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// MESSAGES (per brief thread)
// ════════════════════════════════════════════════════════════
async function canAccessQuote(req, quoteId) {
  const { rows } = await db.query(`SELECT user_id FROM quotes WHERE id = ?`, [quoteId]);
  if (!rows[0]) return false;
  return req.user.role === 'admin' || rows[0].user_id === req.user.id;
}
app.get('/quotes/:id/messages', auth, async (req, res) => {
  try {
    if (!(await canAccessQuote(req, req.params.id))) return res.status(403).json({ message: 'Forbidden' });
    const { rows } = await db.query(`SELECT * FROM messages WHERE quote_id = ? ORDER BY created_at ASC`, [req.params.id]);
    res.json({ messages: rows.map(m => ({ ...m, attachments: jp(m.attachments, []) })) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/quotes/:id/messages', auth, async (req, res) => {
  try {
    if (!(await canAccessQuote(req, req.params.id))) return res.status(403).json({ message: 'Forbidden' });
    const { content, attachments = [] } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ message: 'Empty message' });
    const id = uuidv4();
    const role = req.user.role === 'admin' ? 'admin' : 'client';
    await db.query(
      `INSERT INTO messages (id, quote_id, author_id, role, content, attachments) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, req.user.id, role, content.trim(), JSON.stringify(attachments)]
    );
    await db.query(`UPDATE quotes SET updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
    res.json({ ok: true, message: { id, role, content: content.trim() } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// CASES
// ════════════════════════════════════════════════════════════
// Public list (published) — admin (valid token) sees all incl. drafts.
app.get('/cases', softAuth, async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const category = req.query.category;
    let sql = `SELECT * FROM cases`;
    const params = [];
    const where = [];
    if (!isAdmin) where.push(`published = 1`);
    if (category) { where.push(`category = ?`); params.push(category); }
    if (where.length) sql += ` WHERE ` + where.join(' AND ');
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await db.query(sql, params);
    res.json({ cases: rows.map(shapeCase) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/cases/:slug', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM cases WHERE slug = ?`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ case: shapeCase(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/cases', auth, adminOnly, async (req, res) => {
  try {
    const { title, slug, category = '', tags = [], description = '', cover_image = '', images = [], published = false } = req.body;
    if (!title || !slug) return res.status(400).json({ message: 'Title and slug required' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO cases (id, slug, title, category, tags, description, cover_image, images, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, title, category, JSON.stringify(tags), description, cover_image, JSON.stringify(images), published ? 1 : 0]
    );
    res.json({ ok: true, case: { id, slug } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.patch('/cases/:id', auth, adminOnly, async (req, res) => {
  try {
    const f = req.body;
    const sets = [], params = [];
    const map = { title: f.title, slug: f.slug, category: f.category, description: f.description, cover_image: f.cover_image };
    for (const [k, v] of Object.entries(map)) if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
    if (f.tags !== undefined)      { sets.push(`tags = ?`);      params.push(JSON.stringify(f.tags)); }
    if (f.images !== undefined)    { sets.push(`images = ?`);    params.push(JSON.stringify(f.images)); }
    if (f.published !== undefined) { sets.push(`published = ?`); params.push(f.published ? 1 : 0); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = datetime('now')`);
    params.push(req.params.id);
    await db.query(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/cases/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`DELETE FROM cases WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FILE UPLOAD (presigned R2)
// ════════════════════════════════════════════════════════════
app.post('/upload/presign', auth, async (req, res) => {
  try {
    const { filename, contentType, folder = 'quotes' } = req.body;
    if (!filename) return res.status(400).json({ message: 'filename required' });
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeFolder = ['quotes', 'cases', 'messages', 'products'].includes(folder) ? folder : 'quotes';
    const key = `${safeFolder}/${Date.now()}_${safe}`;
    const url = await presignUpload(key, contentType);
    // Case images + product assets (images/datasheets/SDK) are shown publicly
    // via the /img redirect; private files (quotes/messages) are referenced by
    // key and downloaded through the authenticated /files/signed route.
    const PUBLIC_FOLDERS = ['cases', 'products'];
    const publicUrl = PUBLIC_FOLDERS.includes(safeFolder) ? `/img?key=${encodeURIComponent(key)}` : null;
    res.json({ url, key, publicUrl });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Public asset redirect — serves ONLY case images and product assets
// (cases/ or products/ prefix) by 302-ing to a short-lived presigned GET.
// Quote/message files and backups are never reachable here.
app.get('/img', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key || !/^(cases|products)\//.test(key)) return res.status(403).send('forbidden');
    res.set('Cache-Control', 'public, max-age=300');
    res.redirect(302, await presignDownload(key));
  } catch (e) { res.status(500).send('error'); }
});

// Signed download URL for a private stored key (owner/admin).
app.get('/files/signed', auth, async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ message: 'key required' });
    res.json({ url: await presignDownload(key) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// PUBLIC SETTINGS
// ════════════════════════════════════════════════════════════
// ── Tiny in-memory TTL cache for hot public reads (cuts D1 round-trips) ──
const _mc = new Map();
const mcGet = k => { const e = _mc.get(k); return e && e.exp > Date.now() ? e.v : null; };
const mcSet = (k, v, ttl) => { _mc.set(k, { v, exp: Date.now() + ttl }); };
const mcClear = prefix => { for (const k of [..._mc.keys()]) if (k.startsWith(prefix)) _mc.delete(k); };

app.get('/api/settings/public', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=30');
    const cached = mcGet('settings:public');
    if (cached) return res.json(cached);
    const PUBLIC_KEYS = ['brand_name', 'company_name', 'forum_url', 'github_oauth_enabled',
                         'whatsapp_number', 'engineer_whatsapp', 'contact_address', 'contact_hours',
                         'contact_email', 'paypal_client_id', 'paypal_mode', 'turnstile_site_key'];
    const ph = PUBLIC_KEYS.map(() => '?').join(',');
    const { rows } = await db.query(`SELECT key, value FROM settings WHERE key IN (${ph})`, PUBLIC_KEYS);
    const cfg = {}; rows.forEach(r => cfg[r.key] = r.value);
    mcSet('settings:public', cfg, 30000);
    res.json(cfg);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Public: contact form → emails the admin notification address.
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, subject } = req.body;
    if (!await verifyTurnstile(req.body.cf_turnstile, req.ip)) return res.status(400).json({ message: 'Human verification failed. Please try again.' });
    if (!name || !email || !message) return res.status(400).json({ message: 'Name, email and message are required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: 'Invalid email' });
    const brand = (await getSetting('company_name')) || 'rogersense';
    const to = await getSetting('contact_email');
    if (!to) return res.status(503).json({ message: 'Contact is not configured yet — please email us directly.' });
    await sendMail({
      to,
      subject: `[${brand}] Contact form — ${subject || 'New message'} (${name})`,
      html: `<h2>New contact message</h2><p><b>From:</b> ${name} &lt;${email}&gt;</p>` +
            (subject ? `<p><b>Subject:</b> ${subject}</p>` : '') +
            `<p><b>Message:</b></p><p style="white-space:pre-wrap;">${String(message).replace(/</g, '&lt;')}</p>`,
    }, { throwError: true });
    res.json({ ok: true, message: 'Thanks — your message has been sent.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: read/update settings (encrypted variant for secrets)
app.get('/api/admin/settings', auth, adminOnly, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT key, value, description FROM settings ORDER BY key`);
    res.json({ settings: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/settings/:key', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [req.params.key, String(req.body.value ?? '')]);
    mcClear('settings:');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/settings/encrypted/:key', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [req.params.key, encrypt(String(req.body.value ?? ''))]);
    mcClear('settings:');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: send a test email using the current mail settings.
app.post('/api/admin/mail/test', auth, adminOnly, async (req, res) => {
  try {
    const to = (req.body.to || '').trim();
    if (!to) return res.status(400).json({ message: 'Recipient email required' });
    const brand = (await getSetting('company_name')) || 'rogersense';
    await sendMail({
      to,
      subject: `[${brand}] Test email`,
      html: `<p>This is a test email from your <b>${brand}</b> admin panel.</p>` +
            `<p>If you can read this, your mail server is configured correctly. ✅</p>`,
    }, { throwError: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN — CUSTOMERS
// ════════════════════════════════════════════════════════════
app.get('/api/admin/customers', auth, adminOnly, async (req, res) => {
  try {
    const { q, type } = req.query;
    const where = [`u.role != 'admin'`];
    const params = [];
    if (type) { where.push(`u.customer_type = ?`); params.push(type); }
    if (q) {
      where.push(`(u.email LIKE ? OR u.name LIKE ? OR u.company LIKE ?)`);
      const like = `%${q}%`; params.push(like, like, like);
    }
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.company, u.customer_type, u.email_verified, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM quotes q WHERE q.user_id = u.id) AS brief_count
       FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC`,
      params
    );
    res.json({ customers: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/customers/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
    const u = rows[0];
    if (!u) return res.status(404).json({ message: 'Customer not found' });
    const briefs = (await db.query(
      `SELECT id, quote_no, status, deliverable, created_at FROM quotes WHERE user_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    )).rows;
    res.json({
      customer: {
        id: u.id, name: u.name, email: u.email, company: u.company || '',
        customer_type: u.customer_type || 'normal', note: u.note || '',
        email_verified: u.email_verified, github_id: u.github_id || null,
        last_login_at: u.last_login_at, created_at: u.created_at,
      },
      briefs,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/customers/:id', auth, adminOnly, async (req, res) => {
  try {
    const { customer_type, note, unbind_github } = req.body;
    const sets = [], params = [];
    if (customer_type !== undefined) { sets.push(`customer_type = ?`); params.push(customer_type); }
    if (note !== undefined)          { sets.push(`note = ?`);          params.push(note); }
    if (unbind_github)               { sets.push(`github_id = NULL`); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = datetime('now')`);
    params.push(req.params.id);
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin resets a customer's password: generate a temp password, store the
// hash, return the plaintext once (so the admin can relay it even before
// mail is configured), and email it best-effort.
app.post('/api/admin/customers/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT email, name FROM users WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Customer not found' });
    const temp = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + 'A1';
    const hash = await bcrypt.hash(temp, 12);
    await db.query(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [hash, req.params.id]);
    const brand = (await getSetting('company_name')) || 'rogersense';
    sendMail({
      to: rows[0].email,
      subject: `[${brand}] Your password has been reset`,
      html: `<p>Hi ${rows[0].name || ''},</p>` +
            `<p>An administrator reset your password. Your temporary password is:</p>` +
            `<p style="font-size:1.2rem;font-weight:bold;font-family:monospace">${temp}</p>` +
            `<p>Sign in at <a href="${SITE_URL}/login.html">${SITE_URL}/login.html</a> and change it from your profile.</p>`,
    });
    res.json({ ok: true, temp_password: temp, email: rows[0].email });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN — DASHBOARD STATS
// ════════════════════════════════════════════════════════════
app.get('/api/admin/stats', auth, adminOnly, async (_req, res) => {
  try {
    const [qRes, uRes, rQuotes, rOrders, oRes, cRes] = await Promise.all([
      db.query(`SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END),0) as pending,
        COALESCE(SUM(CASE WHEN status='quoted'    THEN 1 ELSE 0 END),0) as quoted,
        COALESCE(SUM(CASE WHEN status='paid'      THEN 1 ELSE 0 END),0) as paid,
        COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) as completed,
        COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END),0) as today
        FROM quotes`),
      db.query(`SELECT COUNT(*) as total FROM users WHERE role != 'admin'`),
      db.query(`SELECT COALESCE(SUM(total_paid),0) as rev FROM quotes WHERE status IN ('paid','completed')`),
      db.query(`SELECT COALESCE(SUM(total_paid),0) as rev, COUNT(*) as cnt FROM product_orders WHERE status IN ('paid','shipped','completed')`),
      db.query(`SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) as paid,
        COALESCE(SUM(CASE WHEN status='shipped' THEN 1 ELSE 0 END),0) as shipped
        FROM product_orders`),
      db.query(`SELECT COUNT(*) as total FROM cases WHERE published = 1`),
    ]);
    const total_revenue = Number(rQuotes.rows[0]?.rev || 0) + Number(rOrders.rows[0]?.rev || 0);
    res.json({
      quotes: qRes.rows[0], users: uRes.rows[0],
      revenue: { total_revenue, briefs: Number(rQuotes.rows[0]?.rev || 0), store: Number(rOrders.rows[0]?.rev || 0) },
      orders: oRes.rows[0], cases: cRes.rows[0],
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN — ADMIN ACCOUNTS (admin-role users)
// ════════════════════════════════════════════════════════════
app.get('/api/admin/admins', auth, adminOnly, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, name, role, created_at, last_login_at FROM users WHERE role = 'admin' ORDER BY created_at`
    );
    res.json({ admins: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/admins', auth, adminOnly, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    const exists = await db.query(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ message: 'Email already in use' });
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, role, email_verified) VALUES (?, ?, ?, ?, 'admin', 1)`,
      [uuidv4(), email.toLowerCase(), hash, name || 'Admin']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/admins/:id/password', auth, adminOnly, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    const { rows } = await db.query(`SELECT id FROM users WHERE id = ? AND role = 'admin'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Admin not found' });
    const hash = await bcrypt.hash(new_password, 12);
    await db.query(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [hash, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GDPR — data deletion
// ════════════════════════════════════════════════════════════
// Public: a user requests deletion of their data.
app.post('/api/gdpr/delete-request', async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!await verifyTurnstile(req.body.cf_turnstile, req.ip)) return res.status(400).json({ message: 'Human verification failed. Please try again.' });
    if (!email) return res.status(400).json({ message: 'Email required' });
    // Always return success (avoid email enumeration), act only if user exists.
    const { rows } = await db.query(`SELECT id, name FROM users WHERE email = ?`, [email.toLowerCase()]);
    if (rows.length) {
      await db.query(
        `UPDATE users SET deletion_requested_at = datetime('now'), deletion_reason = ? WHERE id = ?`,
        [reason || '', rows[0].id]
      );
      const adminEmail = await getSetting('contact_email');
      if (adminEmail) sendMail({
        to: adminEmail,
        subject: `[rogersense] GDPR Delete Request — ${email}`,
        html: `<h2>GDPR Data Deletion Request</h2><p><b>Email:</b> ${email}</p>` +
              `<p><b>Name:</b> ${rows[0].name || '—'}</p><p><b>Reason:</b> ${reason || '—'}</p>` +
              `<p><b>Requested at:</b> ${new Date().toISOString()}</p>`,
      });
      sendMail({
        to: email,
        subject: '[rogersense] Data Deletion Request Received',
        html: `<p>Hi ${rows[0].name || 'there'},</p>` +
              `<p>We received your request to delete your personal data. We will process it within <b>30 days</b> and email you once complete.</p>`,
      });
    }
    res.json({ ok: true, message: 'Your deletion request has been received. We will process it within 30 days.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Admin: list pending deletion requests.
app.get('/api/admin/gdpr/pending', auth, adminOnly, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, name, deletion_requested_at, deletion_reason FROM users
       WHERE deletion_requested_at IS NOT NULL ORDER BY deletion_requested_at ASC`
    );
    res.json({ pending: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Admin: execute deletion — anonymize the user's briefs, drop addresses + user.
app.delete('/api/admin/gdpr/delete-user', auth, adminOnly, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });
    const { rows } = await db.query(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
    if (!rows[0]) return res.status(404).json({ message: 'User not found' });
    const userId = rows[0].id;
    await db.query(`UPDATE quotes SET user_id = NULL, email = '[deleted]', name = '[deleted]', company = NULL WHERE user_id = ?`, [userId]);
    await db.query(`DELETE FROM addresses WHERE user_id = ?`, [userId]);
    await db.query(`DELETE FROM users WHERE id = ?`, [userId]);
    sendMail({
      to: email,
      subject: '[rogersense] Your Data Has Been Deleted',
      html: `<p>Your personal data has been permanently deleted. Brief records were anonymized for accounting purposes.</p>`,
    });
    res.json({ ok: true, message: `User ${email} deleted and briefs anonymized.` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ME — saved addresses
// ════════════════════════════════════════════════════════════
app.get('/me/addresses', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at`, [req.user.id]);
    res.json({ addresses: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/me/addresses', auth, async (req, res) => {
  try {
    const { label, recipient, phone, address_line, city, country, is_default } = req.body;
    if (is_default) await db.query(`UPDATE addresses SET is_default = 0 WHERE user_id = ?`, [req.user.id]);
    const id = uuidv4();
    await db.query(
      `INSERT INTO addresses (id, user_id, label, recipient, phone, address_line, city, country, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, label || 'Home', recipient || '', phone || '', address_line || '', city || '', country || 'US', is_default ? 1 : 0]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/me/addresses/:id', auth, async (req, res) => {
  try {
    const { label, recipient, phone, address_line, city, country, is_default } = req.body;
    if (is_default) await db.query(`UPDATE addresses SET is_default = 0 WHERE user_id = ?`, [req.user.id]);
    await db.query(
      `UPDATE addresses SET label = COALESCE(?, label), recipient = COALESCE(?, recipient),
       phone = COALESCE(?, phone), address_line = COALESCE(?, address_line),
       city = COALESCE(?, city), country = COALESCE(?, country), is_default = COALESCE(?, is_default)
       WHERE id = ? AND user_id = ?`,
      [label ?? null, recipient ?? null, phone ?? null, address_line ?? null, city ?? null,
       country ?? null, is_default === undefined ? null : (is_default ? 1 : 0), req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/me/addresses/:id', auth, async (req, res) => {
  try {
    await db.query(`DELETE FROM addresses WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// PAYMENT (PayPal) — server-side redirect flow, no extra frontend page
// ════════════════════════════════════════════════════════════
// Public config for any future in-page PayPal button.
app.get('/api/payment/config', async (_req, res) => {
  try {
    const cfg = await getPayPalConfig();
    res.json({ clientId: cfg.clientId, mode: cfg.mode, configured: !!(cfg.clientId && cfg.clientSecret) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: mark a brief as quoted and email the customer a pay link.
app.post('/quotes/:id/send-payment', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT q.*, COALESCE(u.email, q.email) AS customer_email, COALESCE(u.name, q.name, 'Customer') AS customer_name
       FROM quotes q LEFT JOIN users u ON q.user_id = u.id WHERE q.id = ? OR q.quote_no = ?`,
      [req.params.id, req.params.id]
    );
    const q = rows[0];
    if (!q) return res.status(404).json({ message: 'Brief not found' });
    if (!q.quoted_price) return res.status(400).json({ message: 'Set a quoted price first' });
    if (!q.customer_email) return res.status(400).json({ message: 'No customer email on this brief' });
    await db.query(`UPDATE quotes SET status = 'quoted', updated_at = datetime('now') WHERE id = ?`, [q.id]);
    const brand = (await getSetting('company_name')) || 'rogersense';
    const payUrl = `${SITE_URL}/pay?quote=${encodeURIComponent(q.quote_no)}`;
    await sendMail({
      to: q.customer_email,
      subject: `[${brand}] Your quote is ready — ${q.quote_no}`,
      html: `<h2>Your quote is ready</h2><p>Hi ${q.customer_name},</p>` +
            `<p>We've reviewed your brief <b>${q.quote_no}</b>.</p>` +
            `<table style="border-collapse:collapse"><tr><td style="padding:6px;color:#666">Quoted price</td>` +
            `<td style="padding:6px"><b>USD $${q.quoted_price}</b></td></tr>` +
            (q.shipping_fee ? `<tr><td style="padding:6px;color:#666">Shipping</td><td style="padding:6px"><b>USD $${q.shipping_fee}</b></td></tr>` : '') +
            `</table><p style="margin-top:16px"><a href="${payUrl}" style="background:#0d9488;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;border-radius:6px">PAY NOW →</a></p>`,
    }, { throwError: true });
    res.json({ ok: true, message: 'Payment link sent to ' + q.customer_email });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Customer clicks the email link → create a PayPal order and redirect to checkout.
app.get('/pay', async (req, res) => {
  try {
    const quoteNo = String(req.query.quote || '');
    const { rows } = await db.query(`SELECT * FROM quotes WHERE quote_no = ?`, [quoteNo]);
    const q = rows[0];
    if (!q) return res.status(404).send('Brief not found');
    if (q.status === 'paid' || q.status === 'completed') return res.redirect('/dashboard.html?payment=already');
    if (!q.quoted_price) return res.status(400).send('No quoted price set for this brief');
    const total = parseFloat(q.quoted_price) + parseFloat(q.shipping_fee || 0);
    const brand = (await getSetting('company_name')) || 'rogersense';
    const { token: ppToken, base } = await getPayPalToken();
    const ppRes = await fetchFn(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: q.quote_no,
          description: `${brand} ${q.quote_no}`,
          amount: { currency_code: 'USD', value: total.toFixed(2) },
        }],
        application_context: {
          brand_name: brand, landing_page: 'BILLING', user_action: 'PAY_NOW',
          return_url: `${SITE_URL}/pay/return?quote=${encodeURIComponent(q.quote_no)}`,
          cancel_url: `${SITE_URL}/dashboard.html?payment=cancelled`,
        },
      }),
    });
    const ppData = await ppRes.json();
    if (!ppRes.ok) throw new Error(ppData.message || 'PayPal order creation failed');
    await db.query(`UPDATE quotes SET payment_intent = ?, updated_at = datetime('now') WHERE id = ?`, [ppData.id, q.id]);
    const approveUrl = ppData.links?.find(l => l.rel === 'approve')?.href;
    if (!approveUrl) throw new Error('No PayPal approve URL');
    res.redirect(302, approveUrl);
  } catch (e) { res.status(500).send('Payment error: ' + e.message); }
});

// PayPal returns here → capture the payment, then redirect to the dashboard.
app.get('/pay/return', async (req, res) => {
  try {
    const quoteNo = String(req.query.quote || '');
    const paypalOrderId = String(req.query.token || '');
    const { rows } = await db.query(`SELECT * FROM quotes WHERE quote_no = ?`, [quoteNo]);
    const q = rows[0];
    if (!q) return res.status(404).send('Brief not found');
    if (q.status === 'paid' || q.status === 'completed') return res.redirect('/dashboard.html?payment=success');
    if (q.payment_intent && paypalOrderId && q.payment_intent !== paypalOrderId) {
      console.error('[SECURITY] payment_intent mismatch', q.quote_no);
      return res.status(400).send('Invalid payment token');
    }
    const { token: ppToken, base } = await getPayPalToken();
    const capRes = await fetchFn(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
    });
    const capData = await capRes.json();
    if (!capRes.ok || capData.status !== 'COMPLETED') throw new Error(capData.message || 'Capture failed');
    const amountPaid = parseFloat(capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
    await db.query(`UPDATE quotes SET status = 'paid', total_paid = ?, updated_at = datetime('now') WHERE id = ?`, [amountPaid, q.id]);
    const brand = (await getSetting('company_name')) || 'rogersense';
    const adminEmail = await getSetting('contact_email');
    if (adminEmail) sendMail({ to: adminEmail, subject: `[${brand}] 💰 Payment received — ${q.quote_no}`, html: `<p>Brief <b>${q.quote_no}</b> paid: USD $${amountPaid.toFixed(2)}.</p>` });
    if (q.email) sendMail({ to: q.email, subject: `[${brand}] Payment confirmed — ${q.quote_no}`, html: `<p>Thank you! We received your payment of <b>USD $${amountPaid.toFixed(2)}</b> for ${q.quote_no}.</p>` });
    res.redirect(302, '/dashboard.html?payment=success');
  } catch (e) { res.status(500).send('Payment capture error: ' + e.message); }
});

// ════════════════════════════════════════════════════════════
// PRODUCTS (dev boards & tools — fixed price, direct purchase)
// ════════════════════════════════════════════════════════════
function shapeProduct(p) {
  return { ...p, images: jp(p.images, []), downloads: jp(p.downloads, []), price: Number(p.price),
    rating_avg: p.rating_avg != null ? Number(p.rating_avg) : 0, rating_count: Number(p.rating_count || 0) };
}
const RATING_COLS = `(SELECT ROUND(AVG(rating),1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_avg,
  (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count`;
// Public: list active products.
app.get('/api/products', async (req, res) => {
  try {
    const category = req.query.category;
    res.set('Cache-Control', 'public, max-age=30');
    const ckey = 'products:' + (category || 'all');
    const cached = mcGet(ckey);
    if (cached) return res.json(cached);
    let sql = `SELECT p.*, ${RATING_COLS} FROM products p WHERE p.status = 'active'`;
    const params = [];
    if (category) { sql += ` AND p.category = ?`; params.push(category); }
    sql += ` ORDER BY p.sort_order ASC, p.created_at DESC`;
    const { rows } = await db.query(sql, params);
    const out = { products: rows.map(shapeProduct) };
    mcSet(ckey, out, 30000);
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Public: single product by slug.
app.get('/api/products/:slug', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT p.*, ${RATING_COLS} FROM products p WHERE p.slug = ?`, [req.params.slug]);
    if (!rows[0] || rows[0].status !== 'active') return res.status(404).json({ message: 'Not found' });
    res.json({ product: shapeProduct(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Public: list a product's approved reviews (+ aggregate).
app.get('/api/products/:slug/reviews', async (req, res) => {
  try {
    const p = (await db.query(`SELECT id FROM products WHERE slug = ?`, [req.params.slug])).rows[0];
    if (!p) return res.status(404).json({ message: 'Not found' });
    const { rows } = await db.query(
      `SELECT id, author_name, rating, comment, created_at FROM product_reviews
       WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC`, [p.id]);
    const avg = rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : 0;
    res.json({ reviews: rows, count: rows.length, average: avg });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Public: submit a review (shown immediately; admin can remove).
app.post('/api/products/:slug/reviews', async (req, res) => {
  try {
    const { author_name, rating, comment, email } = req.body;
    if (!await verifyTurnstile(req.body.cf_turnstile, req.ip)) return res.status(400).json({ message: 'Human verification failed. Please try again.' });
    if (!author_name || !author_name.trim()) return res.status(400).json({ message: 'Name is required' });
    if (!comment || !comment.trim()) return res.status(400).json({ message: 'Please write a short review' });
    const r = parseInt(rating);
    if (!(r >= 1 && r <= 5)) return res.status(400).json({ message: 'Rating must be 1–5 stars' });
    const p = (await db.query(`SELECT id FROM products WHERE slug = ? AND status = 'active'`, [req.params.slug])).rows[0];
    if (!p) return res.status(404).json({ message: 'Product not found' });
    await db.query(
      `INSERT INTO product_reviews (id, product_id, author_name, email, rating, comment, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [uuidv4(), p.id, author_name.trim().slice(0, 60), (email || '').trim().slice(0, 120), r, comment.trim().slice(0, 2000)]
    );
    res.json({ ok: true, message: 'Thanks! Your review will appear once it has been approved.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Admin: list / approve / delete reviews (moderation).
app.get('/api/admin/reviews', auth, adminOnly, async (req, res) => {
  try {
    const where = req.query.status ? `WHERE rv.status = ?` : '';
    const params = req.query.status ? [req.query.status] : [];
    const { rows } = await db.query(
      `SELECT rv.*, p.name AS product_name, p.slug AS product_slug FROM product_reviews rv
       LEFT JOIN products p ON p.id = rv.product_id ${where} ORDER BY (rv.status='pending') DESC, rv.created_at DESC`, params);
    res.json({ reviews: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/reviews/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`UPDATE product_reviews SET status = 'approved' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/admin/reviews/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`DELETE FROM product_reviews WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: product CRUD.
app.get('/api/admin/products', auth, adminOnly, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM products ORDER BY sort_order ASC, created_at DESC`);
    res.json({ products: rows.map(shapeProduct) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/products', auth, adminOnly, async (req, res) => {
  try {
    const { slug, name, category = 'board', price = 0, currency = 'USD', stock = 0,
            summary = '', description = '', cover_image = '', images = [], downloads = [],
            status = 'active', sort_order = 0 } = req.body;
    if (!slug || !name) return res.status(400).json({ message: 'slug and name required' });
    const exists = await db.query(`SELECT id FROM products WHERE slug = ?`, [slug]);
    if (exists.rows.length) return res.status(409).json({ message: 'Slug already in use' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO products (id, slug, name, category, price, currency, stock, summary, description, cover_image, images, downloads, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, name, category, Number(price) || 0, currency, parseInt(stock) || 0, summary, description,
       cover_image, JSON.stringify(images), JSON.stringify(downloads), status, parseInt(sort_order) || 0]
    );
    mcClear('products:');
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  try {
    const f = req.body;
    const sets = [], params = [];
    const scalar = { slug: f.slug, name: f.name, category: f.category, currency: f.currency,
                     summary: f.summary, description: f.description, cover_image: f.cover_image, status: f.status };
    for (const [k, v] of Object.entries(scalar)) if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
    if (f.price !== undefined)      { sets.push(`price = ?`);      params.push(Number(f.price) || 0); }
    if (f.stock !== undefined)      { sets.push(`stock = ?`);      params.push(parseInt(f.stock) || 0); }
    if (f.sort_order !== undefined) { sets.push(`sort_order = ?`); params.push(parseInt(f.sort_order) || 0); }
    if (f.images !== undefined)     { sets.push(`images = ?`);     params.push(JSON.stringify(f.images)); }
    if (f.downloads !== undefined)  { sets.push(`downloads = ?`);  params.push(JSON.stringify(f.downloads)); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = datetime('now')`);
    params.push(req.params.id);
    await db.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
    mcClear('products:');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`DELETE FROM products WHERE id = ?`, [req.params.id]);
    mcClear('products:');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: list product orders.
app.get('/api/admin/product-orders', auth, adminOnly, async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM product_orders ORDER BY created_at DESC`);
    res.json({ orders: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/product-orders/:id', auth, adminOnly, async (req, res) => {
  try {
    const { status, tracking_no, carrier, admin_note } = req.body;
    const o = (await db.query(`SELECT * FROM product_orders WHERE id = ?`, [req.params.id])).rows[0];
    if (!o) return res.status(404).json({ message: 'Order not found' });
    const sets = [], params = [];
    if (status !== undefined) {
      if (!['pending','paid','shipped','completed','cancelled'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
      sets.push(`status = ?`); params.push(status);
    }
    if (tracking_no !== undefined) { sets.push(`tracking_no = ?`); params.push(tracking_no); }
    if (carrier !== undefined)     { sets.push(`carrier = ?`);     params.push(carrier); }
    if (admin_note !== undefined)  { sets.push(`admin_note = ?`);  params.push(admin_note); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = datetime('now')`); params.push(req.params.id);
    await db.query(`UPDATE product_orders SET ${sets.join(', ')} WHERE id = ?`, params);
    // Notify buyer when a tracking number is first added (or status → shipped).
    const newTracking = tracking_no && tracking_no !== o.tracking_no;
    if ((newTracking || status === 'shipped') && o.buyer_email) {
      const brand = (await getSetting('company_name')) || 'rogersense';
      const tn = tracking_no || o.tracking_no;
      sendMail({ to: o.buyer_email, subject: `[${brand}] Your order ${o.order_no} has shipped`,
        html: `<p>Good news — your order <b>${o.order_no}</b> (${o.product_name}) is on its way.</p>` +
              (tn ? `<p><b>Tracking:</b> ${tn}${(carrier||o.carrier)?` (${carrier||o.carrier})`:''}</p>` : '') +
              `<p>Track it any time at <a href="${SITE_URL}/track.html?order=${encodeURIComponent(o.order_no)}">${SITE_URL}/track.html</a>.</p>` });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Customer: my product orders (logged-in).
app.get('/me/product-orders', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT order_no, product_name, qty, unit_price, total_paid, status, tracking_no, carrier, created_at
       FROM product_orders WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id]);
    res.json({ orders: rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Public: track an order by number + email (no login needed).
app.post('/api/orders/track', async (req, res) => {
  try {
    const orderNo = String(req.body.order_no || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!orderNo || !email) return res.status(400).json({ message: 'Order number and email are required' });
    const { rows } = await db.query(
      `SELECT order_no, product_name, qty, total_paid, status, tracking_no, carrier, created_at
       FROM product_orders WHERE order_no = ? AND lower(buyer_email) = ?`, [orderNo, email]);
    if (!rows[0]) return res.status(404).json({ message: 'No order found with that number and email.' });
    res.json({ order: rows[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Shared: validate + create a product_order, then a PayPal order. Returns ids (+approveUrl if redirect).
async function createProductPurchase(req, { redirect }) {
  const { slug, qty = 1, buyer_email, buyer_name = '', ship_recipient = '', ship_phone = '',
          ship_address = '', ship_city = '', ship_country = 'US' } = req.body;
  const email = (req.user?.email || buyer_email || '').toLowerCase();
  if (!slug || !email) { const e = new Error('Product and buyer email required'); e.status = 400; throw e; }
  const n = Math.max(1, parseInt(qty) || 1);
  const p = (await db.query(`SELECT * FROM products WHERE slug = ? AND status = 'active'`, [slug])).rows[0];
  if (!p) { const e = new Error('Product not available'); e.status = 404; throw e; }
  if (p.stock > 0 && n > p.stock) { const e = new Error(`Only ${p.stock} in stock`); e.status = 400; throw e; }
  const total = (Number(p.price) || 0) * n;
  const orderId = uuidv4();
  const orderNo = 'RP' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + Math.random().toString(36).slice(2, 6).toUpperCase();
  await db.query(
    `INSERT INTO product_orders (id, order_no, product_id, product_name, user_id, buyer_email, buyer_name, qty, unit_price,
      ship_recipient, ship_phone, ship_address, ship_city, ship_country, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [orderId, orderNo, p.id, p.name, req.user?.id || null, email, buyer_name, n, Number(p.price) || 0,
     ship_recipient, ship_phone, ship_address, ship_city, ship_country]
  );
  const brand = (await getSetting('company_name')) || 'rogersense';
  const { token: ppToken, base } = await getPayPalToken();
  const appCtx = { brand_name: brand, landing_page: 'BILLING', user_action: 'PAY_NOW' };
  if (redirect) { appCtx.return_url = `${SITE_URL}/pay/product/return?order=${encodeURIComponent(orderNo)}`; appCtx.cancel_url = `${SITE_URL}/shop.html?payment=cancelled`; }
  const ppRes = await fetchFn(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: orderNo, description: `${brand} — ${p.name} ×${n}`,
        amount: { currency_code: p.currency || 'USD', value: total.toFixed(2) } }],
      application_context: appCtx,
    }),
  });
  const ppData = await ppRes.json();
  if (!ppRes.ok) throw new Error(ppData.message || 'PayPal order creation failed');
  await db.query(`UPDATE product_orders SET payment_intent = ?, updated_at = datetime('now') WHERE id = ?`, [ppData.id, orderId]);
  return { orderNo, ppOrderId: ppData.id, approveUrl: ppData.links?.find(l => l.rel === 'approve')?.href };
}

// Shared: capture a paid PayPal order, mark product_order paid, decrement stock, email.
async function captureProductPurchase(orderNo, paypalOrderId) {
  const o = (await db.query(`SELECT * FROM product_orders WHERE order_no = ?`, [orderNo])).rows[0];
  if (!o) { const e = new Error('Order not found'); e.status = 404; throw e; }
  if (['paid', 'completed', 'shipped'].includes(o.status)) return { order: o, already: true };
  if (o.payment_intent && paypalOrderId && o.payment_intent !== paypalOrderId) {
    console.error('[SECURITY] product payment_intent mismatch', o.order_no);
    const e = new Error('Invalid payment token'); e.status = 400; throw e;
  }
  const { token: ppToken, base } = await getPayPalToken();
  const capRes = await fetchFn(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
  });
  const capData = await capRes.json();
  if (!capRes.ok || capData.status !== 'COMPLETED') throw new Error(capData.message || 'Capture failed');
  const amountPaid = parseFloat(capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
  await db.query(`UPDATE product_orders SET status = 'paid', total_paid = ?, updated_at = datetime('now') WHERE id = ?`, [amountPaid, o.id]);
  await db.query(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0`, [o.qty, o.product_id]);
  const brand = (await getSetting('company_name')) || 'rogersense';
  const adminEmail = await getSetting('contact_email');
  if (adminEmail) sendMail({ to: adminEmail, subject: `[${brand}] 🛒 New order — ${o.order_no}`, html: `<p>Order <b>${o.order_no}</b>: ${o.product_name} ×${o.qty} — USD $${amountPaid.toFixed(2)} paid by ${o.buyer_email}.</p><p>Ship to: ${o.ship_recipient}, ${o.ship_address}, ${o.ship_city}, ${o.ship_country} (${o.ship_phone})</p>` });
  if (o.buyer_email) sendMail({ to: o.buyer_email, subject: `[${brand}] Order confirmed — ${o.order_no}`, html: `<p>Thank you! Your order <b>${o.order_no}</b> (${o.product_name} ×${o.qty}) is confirmed — USD $${amountPaid.toFixed(2)} paid. We'll ship it shortly.</p>` });
  return { order: o, amountPaid };
}

// Redirect flow (PayPal button fallback): create order → return approve URL.
app.post('/api/products/buy', auth, async (req, res) => {
  try {
    const { approveUrl, orderNo } = await createProductPurchase(req, { redirect: true });
    if (!approveUrl) throw new Error('No PayPal approve URL');
    res.json({ ok: true, approve_url: approveUrl, order_no: orderNo });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// SDK flow: create a PayPal order, return its id (used by Smart Buttons / Apple Pay / Google Pay).
app.post('/api/payment/create-order', auth, async (req, res) => {
  try {
    const { ppOrderId, orderNo } = await createProductPurchase(req, { redirect: false });
    res.json({ id: ppOrderId, order_no: orderNo });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// SDK flow: capture an approved order.
app.post('/api/payment/capture-order', auth, async (req, res) => {
  try {
    const orderNo = String(req.body.order_no || '');
    const ppId = String(req.body.paypal_order_id || req.body.orderID || '');
    const r = await captureProductPurchase(orderNo, ppId);
    res.json({ ok: true, order_no: orderNo, paid: r.amountPaid || (r.already ? r.order.total_paid : 0) });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// Apple Pay domain verification file (drop the file from PayPal at project root).
app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
  try {
    const fs = require('fs');
    const f = path.join(__dirname, 'apple-pay-domain-association.txt');
    if (!fs.existsSync(f)) return res.status(404).send('not configured');
    res.type('text/plain').send(fs.readFileSync(f, 'utf8'));
  } catch (e) { res.status(500).send('error'); }
});

// PayPal returns here for product purchases → capture, mark paid, decrement stock.
app.get('/pay/product/return', async (req, res) => {
  try {
    const orderNo = String(req.query.order || '');
    const paypalOrderId = String(req.query.token || '');
    const { rows } = await db.query(`SELECT * FROM product_orders WHERE order_no = ?`, [orderNo]);
    const o = rows[0];
    if (!o) return res.status(404).send('Order not found');
    if (o.status === 'paid' || o.status === 'completed' || o.status === 'shipped')
      return res.redirect('/shop.html?payment=success');
    if (o.payment_intent && paypalOrderId && o.payment_intent !== paypalOrderId) {
      console.error('[SECURITY] product payment_intent mismatch', o.order_no);
      return res.status(400).send('Invalid payment token');
    }
    const { token: ppToken, base } = await getPayPalToken();
    const capRes = await fetchFn(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
    });
    const capData = await capRes.json();
    if (!capRes.ok || capData.status !== 'COMPLETED') throw new Error(capData.message || 'Capture failed');
    const amountPaid = parseFloat(capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
    await db.query(`UPDATE product_orders SET status = 'paid', total_paid = ?, updated_at = datetime('now') WHERE id = ?`, [amountPaid, o.id]);
    await db.query(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0`, [o.qty, o.product_id]);
    const brand = (await getSetting('company_name')) || 'rogersense';
    const adminEmail = await getSetting('contact_email');
    if (adminEmail) sendMail({ to: adminEmail, subject: `[${brand}] 🛒 New order — ${o.order_no}`, html: `<p>Order <b>${o.order_no}</b>: ${o.product_name} ×${o.qty} — USD $${amountPaid.toFixed(2)} paid by ${o.buyer_email}.</p><p>Ship to: ${o.ship_recipient}, ${o.ship_address}, ${o.ship_city}, ${o.ship_country} (${o.ship_phone})</p>` });
    if (o.buyer_email) sendMail({ to: o.buyer_email, subject: `[${brand}] Order confirmed — ${o.order_no}`, html: `<p>Thank you! Your order <b>${o.order_no}</b> (${o.product_name} ×${o.qty}) is confirmed — USD $${amountPaid.toFixed(2)} paid. We'll ship it shortly.</p>` });
    res.redirect(302, '/shop.html?payment=success&order=' + encodeURIComponent(o.order_no));
  } catch (e) { res.status(500).send('Payment capture error: ' + e.message); }
});

// ════════════════════════════════════════════════════════════
// BLOG POSTS
// ════════════════════════════════════════════════════════════
function shapePost(p) { return { ...p, tags: jp(p.tags, []) }; }
// Public: list published posts (paginated, optional ?tag=).
app.get('/api/posts', async (req, res) => {
  try {
    const { tag, page = 1, limit = 12 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = `WHERE status = 'published'`; const params = [];
    if (tag) { where += ` AND tags LIKE ?`; params.push('%' + tag + '%'); }
    const { rows } = await db.query(
      `SELECT id, slug, title, excerpt, cover_url, tags, author, views, published_at, created_at
       FROM posts ${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const countRows = (await db.query(`SELECT COUNT(*) as total FROM posts ${where}`, params)).rows;
    res.json({ posts: rows.map(shapePost), total: Number(countRows[0]?.total || 0) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// Public: single published post by slug (increments views).
app.get('/api/posts/:slug', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ message: 'Post not found' });
    await db.query(`UPDATE posts SET views = views + 1 WHERE slug = ?`, [req.params.slug]);
    res.json({ post: shapePost(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: posts CRUD.
app.get('/api/admin/posts', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    let where = ''; const params = [];
    if (status) { where = `WHERE status = ?`; params.push(status); }
    const { rows } = await db.query(
      `SELECT id, slug, title, excerpt, cover_url, tags, status, author, views, published_at, created_at, updated_at
       FROM posts ${where} ORDER BY created_at DESC`, params);
    res.json({ posts: rows.map(shapePost) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/admin/posts/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM posts WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Post not found' });
    res.json({ post: shapePost(rows[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/posts', auth, adminOnly, async (req, res) => {
  try {
    const { title, slug, excerpt, content, cover_url, tags, status, author } = req.body;
    if (!title || !slug) return res.status(400).json({ message: 'title and slug required' });
    const exists = await db.query(`SELECT id FROM posts WHERE slug = ?`, [slug]);
    if (exists.rows.length) return res.status(409).json({ message: 'Slug already exists' });
    const id = uuidv4();
    const published_at = status === 'published' ? new Date().toISOString() : null;
    await db.query(
      `INSERT INTO posts (id, slug, title, excerpt, content, cover_url, tags, status, author, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, title, excerpt || '', content || '', cover_url || '',
       JSON.stringify(tags || []), status || 'draft', author || 'Rogersense Team', published_at]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/posts/:id', auth, adminOnly, async (req, res) => {
  try {
    const { title, slug, excerpt, content, cover_url, tags, status, author } = req.body;
    if (slug) {
      const dup = await db.query(`SELECT id FROM posts WHERE slug = ? AND id != ?`, [slug, req.params.id]);
      if (dup.rows.length) return res.status(409).json({ message: 'Slug already exists' });
    }
    const cur = (await db.query(`SELECT status, published_at FROM posts WHERE id = ?`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ message: 'Post not found' });
    const published_at = (status === 'published' && !cur.published_at) ? new Date().toISOString() : cur.published_at;
    await db.query(
      `UPDATE posts SET title = COALESCE(?, title), slug = COALESCE(?, slug), excerpt = COALESCE(?, excerpt),
       content = COALESCE(?, content), cover_url = COALESCE(?, cover_url), tags = COALESCE(?, tags),
       status = COALESCE(?, status), author = COALESCE(?, author), published_at = ?, updated_at = datetime('now') WHERE id = ?`,
      [title ?? null, slug ?? null, excerpt ?? null, content ?? null, cover_url ?? null,
       tags ? JSON.stringify(tags) : null, status ?? null, author ?? null, published_at, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/admin/posts/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`DELETE FROM posts WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SITEMAP_STATIC_PATHS = [
  '/',
  '/shop.html',
  '/cases.html',
  '/blog.html',
  '/about.html',
  '/quote.html',
  '/contact.html',
  '/track.html',
  '/privacy.html',
  '/returns.html',
  '/shipping.html',
  '/gdpr.html',
  '/terms.html',
];

function sitemapUrl(pathname) {
  return xmlEscape(`${SITE_URL}${pathname}`);
}

// SEO: sitemap of static pages, published cases, products and posts.
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const [cases, products, posts] = await Promise.all([
      db.query(`SELECT slug FROM cases WHERE published = 1`),
      db.query(`SELECT slug FROM products WHERE status = 'active'`),
      db.query(`SELECT slug, updated_at FROM posts WHERE status = 'published'`),
    ]);
    const entries = [
      ...SITEMAP_STATIC_PATHS.map(u => `<url><loc>${sitemapUrl(u)}</loc></url>`),
      ...cases.rows.map(c => `<url><loc>${sitemapUrl(`/case-detail.html?slug=${encodeURIComponent(c.slug)}`)}</loc></url>`),
      ...products.rows.map(p => `<url><loc>${sitemapUrl(`/product.html?slug=${encodeURIComponent(p.slug)}`)}</loc></url>`),
      ...posts.rows.map(p => `<url><loc>${sitemapUrl(`/blog-post.html?slug=${encodeURIComponent(p.slug)}`)}</loc></url>`),
    ];
    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`);
  } catch (e) { res.status(500).send('error'); }
});

// SEO: sitemap index for crawlers that request the index entrypoint.
app.get('/sitemap_index.xml', (_req, res) => {
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<sitemap><loc>' + sitemapUrl('/sitemap.xml') + '</loc></sitemap>\n</sitemapindex>');
});

// SEO: server-render blog-post.html (inject title/meta/OG/JSON-LD + article
// body so crawlers get full content without executing JS).
app.get('/blog-post.html', async (req, res, next) => {
  try {
    const slug = String(req.query.slug || '');
    const fs = require('fs');
    let html = fs.readFileSync(path.join(__dirname, 'blog-post.html'), 'utf8');
    if (!slug) return res.send(html);
    const { rows } = await db.query(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`, [slug]);
    const p = rows[0];
    if (!p) return res.send(html);
    db.query(`UPDATE posts SET views = views + 1 WHERE slug = ?`, [slug]).catch(() => {});
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    const tags = jp(p.tags, []);
    const url = `${SITE_URL}/blog-post.html?slug=${encodeURIComponent(slug)}`;
    const desc = esc(p.excerpt || p.title);
    const cover = p.cover_url ? (p.cover_url.startsWith('http') ? p.cover_url : SITE_URL + p.cover_url) : '';
    const date = p.published_at || p.created_at;
    const ld = {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: p.title, description: p.excerpt || '', author: { '@type': 'Organization', name: p.author || 'Rogersense' },
      publisher: { '@type': 'Organization', name: 'Rogersense' },
      datePublished: date, dateModified: p.updated_at || date,
      mainEntityOfPage: url, ...(cover ? { image: [cover] } : {}), ...(tags.length ? { keywords: tags.join(', ') } : {}),
    };
    const head = [
      `<title>${esc(p.title)} — Rogersense</title>`,
      `<meta name="description" content="${desc}"/>`,
      `<link rel="canonical" href="${url}"/>`,
      `<meta property="og:type" content="article"/>`,
      `<meta property="og:title" content="${esc(p.title)}"/>`,
      `<meta property="og:description" content="${desc}"/>`,
      `<meta property="og:url" content="${url}"/>`,
      cover ? `<meta property="og:image" content="${esc(cover)}"/>` : '',
      `<meta name="twitter:card" content="${cover ? 'summary_large_image' : 'summary'}"/>`,
      `<meta name="twitter:title" content="${esc(p.title)}"/>`,
      `<meta name="twitter:description" content="${desc}"/>`,
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    ].filter(Boolean).join('\n  ');
    // Replace placeholder title + meta, then inject the rest before </head>.
    html = html
      .replace(/<title id="page-title">[^<]*<\/title>/, '')
      .replace(/<meta name="description" id="meta-desc"[^>]*>/, '')
      .replace('</head>', `  ${head}\n</head>`);
    // Server-render the article body so content is in the initial HTML.
    const body = `<p class="eyebrow mb-8">${tags.map(esc).join(' · ') || 'Article'}</p>` +
      `<h1 style="font-size:clamp(1.7rem,4.5vw,2.4rem);line-height:1.2;">${esc(p.title)}</h1>` +
      `<p style="color:var(--color-text-light);font-size:.85rem;margin-top:10px;">${date ? new Date(date).toDateString() : ''}${p.author ? ' · ' + esc(p.author) : ''}</p>` +
      (cover ? `<img class="article-cover" src="${esc(p.cover_url)}" alt="${esc(p.title)}"/>` : '') +
      `<div class="article-body">${p.content || ''}</div>`;
    html = html.replace(/(<article class="article" id="article")(>)[\s\S]*?(<\/article>)/,
      `$1 data-ssr="1"$2${body}$3`);
    res.send(html);
  } catch (e) { next(); }
});

// SEO: robots.txt
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap_index.xml\n`);
});

// ════════════════════════════════════════════════════════════
// STATIC FRONTEND (explicit whitelist — never serve server.js/.env)
// ════════════════════════════════════════════════════════════
// Versioned assets (main.js?v=N, style.css) — cache hard at the edge + browser.
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  maxAge: '7d',
  setHeaders: (res) => res.set('Cache-Control', 'public, max-age=604800'),
}));
// Only `.html` page routes (+ `/`) — extensionless aliases are intentionally
// omitted so they never collide with API routes like GET /cases.
const PAGES = ['index', 'cases', 'case-detail', 'quote', 'about', 'login', 'dashboard', 'admin', 'shop', 'product', 'blog', 'blog-post', 'contact', 'privacy', 'returns', 'shipping', 'gdpr', 'terms', 'reset', 'track'];
// Pages with per-user / sensitive content must never be edge-cached.
const NO_CACHE_PAGES = new Set(['admin', 'login', 'dashboard', 'reset']);
function sendPage(res, name) {
  res.set('Cache-Control', NO_CACHE_PAGES.has(name) ? 'no-store'
    : 'public, max-age=300, s-maxage=600');   // browser 5min, CDN edge 10min
  res.sendFile(path.join(__dirname, `${name}.html`));
}
app.get('/', (_req, res) => sendPage(res, 'index'));
// Clean admin entrance: /admin → admin.html (/admin.html also still works).
app.get('/admin', (_req, res) => sendPage(res, 'admin'));
PAGES.forEach(name => {
  app.get(`/${name}.html`, (_req, res) => sendPage(res, name));
});
app.get('/track', (_req, res) => sendPage(res, 'track'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Favicon (SVG) — sensor mark.
app.get('/favicon.svg', (_req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=300').sendFile(path.join(__dirname, 'favicon.svg'));
});
app.get('/favicon.ico', (_req, res) => res.redirect(302, '/favicon.svg?v=20260606'));

// Friendly 404 for unknown GET routes (after all real routes).
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) return res.status(404).sendFile(path.join(__dirname, '404.html'));
  res.status(404).json({ message: 'Not found' });
});

// ── Boot ────────────────────────────────────────────────────
db.initDB()
  .catch(err => console.error('initDB error:', err.message))
  .finally(() => {
    // Bind to loopback only — Nginx reverse-proxies from the same host.
    // Port 3002 is never exposed externally (no firewall opening needed).
    app.listen(PORT, '127.0.0.1', () => console.log(`🚀 rogersense server on http://127.0.0.1:${PORT}`));
  });

module.exports = app;
