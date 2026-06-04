# System Architecture

> Last updated: 2026-06-04
> Status: Confirmed ✅ — revised to the **VPS + Node/Express + Cloudflare D1/R2** stack
> Repo: `andrewljf001/rogersense`

---

## Guiding Principle

**The VPS runs only stateless business logic. All persistent data lives in Cloudflare (D1 + R2).**

If the VPS dies or is replaced, no data is lost — we redeploy the code and reconnect. This mirrors the proven production architecture of our sister project (PCBAForge), adapted to rogersense's business domain (project briefs, quotes, cases, message threads).

```
                          User's Browser
                                │
                    Cloudflare CDN / SSL / DDoS
                    (hides VPS IP, global edge)
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                     ▼
   ┌────────────────────┐                ┌────────────────────┐
   │  VPS (US)          │                │  VPS (US)          │
   │  Nginx reverse     │                │  Flarum (PHP)      │
   │  proxy + SSL       │                │  + dedicated MySQL │
   │      │             │                │  (isolated vhost)  │
   │      ▼             │                └─────────┬──────────┘
   │  Node.js + Express │◄────────── SSO ──────────┘
   │  (stateless)       │
   └─────┬───────┬──────┘
         │       │
         ▼       ▼
   ┌──────────┐ ┌──────────────┐
   │ CF D1    │ │ CF R2        │
   │ (SQLite, │ │ (S3-compat   │
   │  HTTP)   │ │  object store)│
   └──────────┘ └──────────────┘
```

### Why this over Cloudflare Workers

The earlier draft of this document planned a Workers-serverless backend. We are instead running **Node.js + Express on the existing VPS**, because:

- We already own and operate a VPS (same box that will host the Flarum forum).
- The data layer (D1 + R2) is identical either way — D1 is reached over its **HTTP REST API**, so a normal Node process can use it just as well as a Worker.
- A single long-lived Node server is simpler to debug, gives us full control of middleware/OAuth/file handling, and reuses a battle-tested codebase already running in production for the sister project.
- Operations (PM2, Nginx, backup cron, Let's Encrypt) are already established on the VPS.

---

## System 1 — Main Site (frontend)

| Item | Detail |
|------|--------|
| Stack | Static HTML / CSS / JS — **no build step** |
| Hosting | Served by the same Node/Express process via `express.static` (or Nginx static), behind Cloudflare |
| Repo | `andrewljf001/rogersense` (frontend + backend in one repo) |
| Style | **Deep Navy + Electric Teal** design system in `assets/style.css` — locked, do not restyle |
| URL | `[BRAND].com` (custom domain via Cloudflare) |

### Pages

| File | Route | Description |
|------|-------|-------------|
| `index.html` | `/` | Homepage — hero, how it works, services, inline brief form, cases preview, dev boards CTA |
| `cases.html` | `/cases` | Case showcase — category tabs + photo grid (API-driven, placeholder fallback) |
| `case-detail.html` | `/case-detail?slug=` | Single case — cover, gallery + lightbox, description |
| `quote.html` | `/quote` | 5-step brief form (disciplines → deliverable → description → files → contact); requires login |
| `about.html` | `/about` | About the team |
| `login.html` | `/login` | Login / Register (email+password + GitHub OAuth) |
| `dashboard.html` | `/dashboard` | Client dashboard — my briefs, status, message thread, profile |
| `admin.html` | `/admin` | Admin panel — manage briefs (status + reply), manage cases (CRUD) |

### Frontend ↔ Backend contract

`assets/main.js` already implements the client:
- `Auth` — JWT in `localStorage`, `Authorization: Bearer` header.
- `apiFetch()` — wrapper; `API_BASE` points to the backend origin (was `https://api.[BRAND].com`, will become the real API origin).
- `AuthAPI` / `QuotesAPI` / `MessagesAPI` / `CasesAPI` / `UploadAPI` — map 1:1 to the endpoints below.

No visual changes are needed to wire the backend — only `API_BASE` and a few field-name alignments.

---

## System 2 — API Backend (the new core)

| Item | Detail |
|------|--------|
| Runtime | Node.js 18+ / Express, single `server.js` + `database.js` |
| Process mgmt | PM2 on the VPS (`ecosystem.config.js`) |
| Reverse proxy | Nginx (SSL termination, rate limiting, security headers) |
| Auth | bcrypt (cost 12) + dual JWT (user 7d / admin 12h) + GitHub OAuth (passport) |
| DB | **Cloudflare D1 (SQLite)** over HTTP REST API |
| Files | **Cloudflare R2** (S3-compatible) via `@aws-sdk/client-s3` |
| Secrets at rest | AES-256-GCM (`SETTINGS_ENCRYPT_KEY`) for SMTP password / API keys stored in `settings` |
| Base URL | `api.[BRAND].com` (or `/api` on the same origin behind Nginx) |

### Database access pattern (D1 over HTTP)

`database.js` exposes a single `query(sql, params)` helper that POSTs to:

```
https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query
Authorization: Bearer {CLOUDFLARE_API_TOKEN}
```

- SQL uses `?` placeholders (Postgres-style `$1` is auto-rewritten to `?`).
- Returns `{ rows, rowCount }`.
- `initDB()` creates tables, seeds `settings`, seeds a default admin, and runs idempotent `ALTER TABLE` migrations on every boot.

### Data Storage — D1 (SQLite)

Free tier: 5GB storage, 5M reads/day, 100K writes/day.

```sql
-- Clients
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,            -- uuid
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,                        -- null when OAuth-only
  name           TEXT NOT NULL DEFAULT '',
  company        TEXT,
  github_id      TEXT,
  email_verified INTEGER DEFAULT 0,
  verify_token   TEXT,
  reset_token    TEXT,
  reset_token_expires TEXT,
  last_login_at  TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- Operators (separate table, separate JWT secret)
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT DEFAULT 'admin',         -- admin | superadmin
  last_login_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Project briefs (a.k.a. quotes)
CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  quote_no     TEXT UNIQUE NOT NULL,          -- RS + yymmdd + random
  user_id      TEXT,
  guest_email  TEXT,
  disciplines  TEXT DEFAULT '[]',             -- JSON: ["hardware","firmware",...]
  deliverable  TEXT,                          -- pcba | product | prototype | unsure
  description  TEXT,
  files        TEXT DEFAULT '[]',             -- JSON: [{name, key, size}]
  status       TEXT DEFAULT 'pending',        -- pending→reviewing→quoted→confirmed→production→completed→cancelled
  quoted_price REAL,
  admin_note   TEXT,
  name         TEXT,                          -- contact snapshot
  email        TEXT,
  company      TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- Message thread per brief
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  quote_id    TEXT NOT NULL,
  author_id   TEXT,                           -- user id or admin id
  role        TEXT NOT NULL,                  -- client | admin
  content     TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',              -- JSON: [{name, key}]
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Portfolio cases
CREATE TABLE IF NOT EXISTS cases (
  id          TEXT PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT,                           -- iot | industrial | consumer | medical | devboard
  tags        TEXT DEFAULT '[]',              -- JSON
  description TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',                -- R2 key or URL
  images      TEXT DEFAULT '[]',              -- JSON: [R2 keys]
  published   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Config / system settings (key-value, drives site + integrations)
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT DEFAULT '',
  description TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

`settings` seeds (subset): `company_name`, `contact_email`, `brand_name`, `mail_driver`, `mail_from`, `smtp_*` (password encrypted as `smtp_pass_enc`), `resend_api_key_enc`, `github_oauth_enabled`, `forum_url`.

### File Storage — R2 (S3-compatible)

Free tier: 10GB storage, 1M writes/month, zero egress.

```
[BRAND]-files/
  quotes/{quote_no}/{filename}       ← client brief attachments
  cases/{case_id}/cover.jpg
  cases/{case_id}/{n}.jpg            ← case photos
  messages/{message_id}/{filename}   ← message attachments
  backups/d1/{date}/backup-*.json.gz ← daily DB backups
  backups/d1/latest.json.gz
```

Flow: `multer` (memory storage) receives the upload → `PutObjectCommand` writes to R2 → DB stores the key → downloads use a **presigned URL (~1h)**. Buckets are private; no public direct links.

### API Endpoints

```
Public
  GET    /api/settings/public        public config whitelist (brand, forum url, github toggle)
  POST   /api/quotes                 submit a brief (multipart, files → R2)   [auth or guest]
  GET    /api/cases                  list published cases (?category=)
  GET    /api/cases/:slug            case detail
  POST   /api/quotes/lookup          look up a brief by quote_no (guest tracking)

Auth (client JWT — JWT_SECRET, 7d)
  POST   /api/auth/register
  POST   /api/auth/login
  POST   /api/auth/github            GitHub OAuth exchange
  GET    /api/auth/verify            email verification
  POST   /api/auth/forgot-password
  POST   /api/auth/reset-password
  GET    /api/me                     current user
  PUT    /api/me                     update profile
  PUT    /api/me/password
  GET    /api/me/quotes              my briefs
  GET    /api/quotes/:id             brief detail (owner only)
  GET    /api/quotes/:id/messages
  POST   /api/quotes/:id/messages    send message + optional attachments

Admin (admin JWT — JWT_ADMIN_SECRET, 12h)
  POST   /api/admin/login
  GET    /api/admin/stats            dashboard counts
  GET    /api/admin/quotes           list (?status=)
  GET    /api/admin/quotes/:id
  PUT    /api/admin/quotes/:id       update status / quoted_price / admin_note
  POST   /api/admin/quotes/:id/messages
  GET    /api/admin/cases            list all (incl. drafts)
  POST   /api/admin/cases            create
  PUT    /api/admin/cases/:id        update
  DELETE /api/admin/cases/:id
  POST   /api/admin/upload           presigned upload helper / direct upload
  GET    /api/admin/settings
  PUT    /api/admin/settings/:key
  PUT    /api/admin/settings/encrypted/:key   AES-256-GCM at rest

OAuth2 server (for Flarum SSO)
  GET    /oauth/authorize
  POST   /oauth/token
  GET    /oauth/userinfo
```

---

## System 3 — Forum

| Item | Detail |
|------|--------|
| Platform | Flarum (PHP + MySQL), open source |
| Hosting | Same VPS, isolated Nginx vhost |
| Database | **Dedicated MySQL** — not shared with anything else |
| URL | `forum.[BRAND].com` |
| Theme | **Custom CSS matching the main site** — same Deep Navy + Electric Teal system (NOT a separate palette) |

### SSO

Flarum uses `fof/passport` to authenticate against our Express OAuth2 endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`). The main site is the identity provider; forum accounts are provisioned from main-site logins. Direct forum signup still allowed.

### Categories

Announcements · General · Hardware · Firmware & Software · Mechanical · Dev Boards & SDK · Project Ideas · Bug Reports.

---

## Deployment & Operations (VPS)

| Concern | Approach |
|---------|----------|
| Project dir | `/var/www/[BRAND]` |
| Process | PM2 (`ecosystem.config.js`): main app + nightly backup cron |
| Reverse proxy | Nginx — `[BRAND].com` → Node :PORT; `forum.[BRAND].com` → Flarum |
| TLS | Let's Encrypt / Certbot (auto-renew) |
| Update | `git pull --no-rebase origin main && pm2 restart [BRAND]` (`npm install` if deps changed) |
| Env | `/var/www/[BRAND]/.env` — never committed; holds JWT secrets, CF tokens, R2 keys, OAuth secrets |

### Backup & Restore

- **Backup** (`scripts/backup-d1.js`, cron daily): dump D1 business tables → JSON → gzip → R2 `backups/d1/{date}/`, keep 30 days, also write `latest.json.gz` + `manifest.json`, email on completion. `settings` is excluded (contains encrypted secrets) or handled separately.
- **Restore** (`restore.js`): `--list` → `--dry-run` → `--confirm`. Takes a pre-restore snapshot to R2 first (so a bad restore is reversible). Strategy: `INSERT OR REPLACE` by primary key.

### Security baseline

- SSH: non-standard port, key-only, no root login.
- UFW: allow 80/443/SSH only; deny direct Node port, MySQL, Redis.
- Nginx: rate limits (login endpoints 5/min, `/api` 30/min), security headers, `server_tokens off`.
- Cloudflare: Full (Strict) TLS, Bot Fight Mode, Turnstile on auth/submit forms.
- App: dual JWT, bcrypt cost 12, AES-256-GCM for secrets, R2 via presigned URLs only.

---

## Cost Summary

| Service | Free tier | Est. cost |
|---------|-----------|-----------|
| Cloudflare D1 | 5GB / 5M reads-day | $0 |
| Cloudflare R2 | 10GB / 1M writes-mo / 0 egress | $0 |
| Cloudflare CDN/SSL | — | $0 |
| VPS (Node + Flarum, shared) | — | already owned |
| **New monthly cost** | | **$0** |

---

## Repo Layout (target)

```
rogersense/
├── ARCHITECTURE.md / PROGRESS.md / README.md
├── server.js                 # all Express routes
├── database.js               # D1 HTTP client + initDB
├── backup.js / restore.js    # data safety
├── scripts/backup-d1.js      # cron entry
├── ecosystem.config.js       # PM2
├── package.json
├── .env.example              # documented, real .env gitignored
├── assets/                   # style.css (locked theme) + main.js (API client)
├── index.html cases.html case-detail.html quote.html
├── about.html login.html dashboard.html admin.html
└── uploads/                  # (gitignored; only used if a local-disk fallback is enabled)
```
