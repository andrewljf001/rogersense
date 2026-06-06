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
const SITE_URL_RAW = process.env.SITE_URL || '';
const SITE_URL   = (SITE_URL_RAW || `http://localhost:${PORT}`).replace(/\/$/, '');
const SEO_SITE_URL = (process.env.SEO_SITE_URL || SITE_URL_RAW || 'https://rogersense.com').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_TTL    = '7d';

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
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', (req, res, nxt) => { res.set('Cache-Control', 'no-store'); nxt(); });

// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
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
    const safeFolder = ['quotes', 'cases', 'messages'].includes(folder) ? folder : 'quotes';
    const key = `${safeFolder}/${Date.now()}_${safe}`;
    const url = await presignUpload(key, contentType);
    // Case images are shown publicly via the /img redirect (cases/ only);
    // private files (quotes/messages) are referenced by key and downloaded
    // through the authenticated /files/signed route.
    const publicUrl = safeFolder === 'cases' ? `/img?key=${encodeURIComponent(key)}` : null;
    res.json({ url, key, publicUrl });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Public image redirect — serves ONLY case images (cases/ prefix) by
// 302-ing to a short-lived presigned GET. Quote/message files and backups
// are never reachable here.
app.get('/img', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key || !/^cases\//.test(key)) return res.status(403).send('forbidden');
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
app.get('/api/settings/public', async (_req, res) => {
  try {
    const PUBLIC_KEYS = ['brand_name', 'company_name', 'forum_url', 'github_oauth_enabled'];
    const ph = PUBLIC_KEYS.map(() => '?').join(',');
    const { rows } = await db.query(`SELECT key, value FROM settings WHERE key IN (${ph})`, PUBLIC_KEYS);
    const cfg = {}; rows.forEach(r => cfg[r.key] = r.value);
    res.json(cfg);
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/admin/settings/encrypted/:key', auth, adminOnly, async (req, res) => {
  try {
    await db.query(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [req.params.key, encrypt(String(req.body.value ?? ''))]);
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
// STATIC FRONTEND (explicit whitelist — never serve server.js/.env)
// ════════════════════════════════════════════════════════════
app.use('/assets', express.static(path.join(__dirname, 'assets')));

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SITEMAP_PATHS = [
  '/',
  '/shop.html',
  '/cases.html',
  '/blog.html',
  '/about.html',
  '/quote.html',
  '/case-detail.html?slug=autonomous-warehouse-robot-lidar',
  '/product.html?slug=lidar-s1',
  '/blog-post.html?slug=semi-solid-state-lidar-explained',
];

function canonicalUrl(pathname) {
  return new URL(pathname, SEO_SITE_URL + '/').toString();
}

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${canonicalUrl('/sitemap.xml')}`,
    '',
  ].join('\n'));
});

app.get('/sitemap.xml', (_req, res) => {
  const urls = SITEMAP_PATHS
    .map(pathname => `<url><loc>${xmlEscape(canonicalUrl(pathname))}</loc></url>`)
    .join('\n');
  res.type('application/xml').send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n'));
});

app.get('/sitemap_index.xml', (_req, res) => {
  res.type('application/xml').send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<sitemap><loc>${xmlEscape(canonicalUrl('/sitemap.xml'))}</loc></sitemap>`,
    '</sitemapindex>',
    '',
  ].join('\n'));
});

// Only `.html` page routes (+ `/`) — extensionless aliases are intentionally
// omitted so they never collide with API routes like GET /cases.
const PAGES = ['index', 'cases', 'case-detail', 'quote', 'about', 'login', 'dashboard', 'admin'];
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
PAGES.forEach(name => {
  app.get(`/${name}.html`, (_req, res) => res.sendFile(path.join(__dirname, `${name}.html`)));
});
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Boot ────────────────────────────────────────────────────
db.initDB()
  .catch(err => console.error('initDB error:', err.message))
  .finally(() => {
    // Bind to loopback only — Nginx reverse-proxies from the same host.
    // Port 3002 is never exposed externally (no firewall opening needed).
    app.listen(PORT, '127.0.0.1', () => console.log(`🚀 rogersense server on http://127.0.0.1:${PORT}`));
  });

module.exports = app;
