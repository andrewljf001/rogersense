# System Architecture

> Last updated: 2026-06-02  
> Status: Confirmed ✅

---

## Overview

The platform consists of three independently deployed systems that share user identity via OAuth2 SSO. Each system has its own data store — no shared databases, no cross-system dependencies at the infrastructure level.

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                           │
└──────────┬──────────────────────┬──────────────────────────────┘
           │                      │                      │
           ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────┐
│   Main Site     │  │   API Backend        │  │     Forum       │
│  GitHub Pages   │  │ Cloudflare Workers  │  │ Flarum on VPS   │
│  Static HTML    │  │                     │  │                 │
│  CSS / JS       │◄─►  D1 (SQLite)        │  │  MySQL (own DB) │
└─────────────────┘  │  R2 (File Storage)  │  └────────┬────────┘
                     │  OAuth2 Server      │◄──SSO─────┘
                     └─────────────────────┘
```

---

## System 1 — Main Site

| Item | Detail |
|------|--------|
| Hosting | GitHub Pages (free) |
| Stack | Static HTML / CSS / JS |
| Repo | `andrewljf001/hw-solution-site` |
| URL | `[BRAND].com` (custom domain via GitHub Pages) |
| Build | No build step — pure static files |

### Pages

| File | Route | Description |
|------|-------|-------------|
| `index.html` | `/` | Homepage — hero, how it works, services, cases preview, dev boards CTA |
| `cases.html` | `/cases` | Case showcase — category tabs, photo grid, text description |
| `quote.html` | `/quote` | Full quote request form (requires login) |
| `about.html` | `/about` | About the team |
| `forum.html` | `/forum` | Forum entry page — redirects to `forum.[BRAND].com` |
| `admin.html` | `/admin` | Admin panel — manage cases, view quote submissions |
| `dashboard.html` | `/dashboard` | User dashboard — my quotes, status, messages |

### Frontend Auth Flow

```
User visits /quote
  → Not logged in → redirect to /login
  → Logged in     → show quote form

Submit quote
  → POST to Cloudflare Workers API
  → Workers validates JWT
  → Stores in D1, files go to R2
  → Returns success → show confirmation
```

---

## System 2 — API Backend

| Item | Detail |
|------|--------|
| Platform | Cloudflare Workers (serverless, edge) |
| Runtime | JavaScript / TypeScript |
| Auth library | `better-auth` (email+password, GitHub OAuth, JWT) |
| Repo | `andrewljf001/hw-solution-api` (to be created) |
| Base URL | `api.[BRAND].com` (Cloudflare custom domain) |

### Data Storage

#### Cloudflare D1 (SQLite)

Free tier: 5GB storage, 5M rows read/day, 100K rows written/day

**Tables:**

```sql
-- Users
users (
  id, email, password_hash, name, company,
  avatar_url, role,           -- role: client | admin
  created_at, updated_at
)

-- OAuth accounts (GitHub login)
oauth_accounts (
  id, user_id, provider, provider_account_id,
  access_token, created_at
)

-- Sessions
sessions (
  id, user_id, token, expires_at, created_at
)

-- Quote requests
quotes (
  id, user_id,
  disciplines,        -- JSON: ["hardware","firmware","mechanical"]
  deliverable,        -- pcba | product | prototype | unsure
  description,        -- free text
  files,              -- JSON: [{name, r2_key, size}]
  status,             -- pending | reviewing | quoted | confirmed | in_production | completed | cancelled
  created_at, updated_at
)

-- Messages (per quote thread)
messages (
  id, quote_id, user_id,
  role,               -- client | admin
  content,
  attachments,        -- JSON: [{name, r2_key}]
  created_at
)

-- Cases (portfolio)
cases (
  id, title, slug,
  category,           -- iot | industrial | consumer | devboard
  tags,               -- JSON: ["BLE","embedded","AWS"]
  description,
  cover_image,        -- R2 key
  images,             -- JSON: [r2_keys]
  published,          -- boolean
  created_at, updated_at
)
```

#### Cloudflare R2 (Object Storage)

Free tier: 10GB storage, 1M writes/month, zero egress fees

**Bucket structure:**

```
hw-solution-bucket/
  quotes/
    {quote_id}/
      {filename}          ← client uploaded attachments
  cases/
    {case_id}/
      cover.jpg
      {n}.jpg             ← case photos
  messages/
    {message_id}/
      {filename}          ← message attachments
  admin/
    quotes/
      {quote_id}/
        quote_{n}.pdf     ← admin uploaded quote PDFs
```

### API Endpoints

```
Auth
  POST   /auth/register
  POST   /auth/login
  POST   /auth/logout
  GET    /auth/me
  GET    /auth/github          ← OAuth redirect
  GET    /auth/github/callback

Quotes
  POST   /quotes               ← submit new quote (auth required)
  GET    /quotes               ← list my quotes (auth required)
  GET    /quotes/:id           ← get quote detail (auth required)
  PATCH  /quotes/:id/status    ← update status (admin only)

Messages
  GET    /quotes/:id/messages  ← get thread (auth required)
  POST   /quotes/:id/messages  ← send message (auth required)

Files
  POST   /upload/presign       ← get R2 presigned upload URL
  DELETE /upload/:key          ← delete file (admin only)

Cases (admin)
  GET    /cases                ← list cases (public)
  GET    /cases/:slug          ← get case detail (public)
  POST   /cases                ← create case (admin only)
  PATCH  /cases/:id            ← update case (admin only)
  DELETE /cases/:id            ← delete case (admin only)

OAuth2 Server (for Flarum SSO)
  GET    /oauth/authorize
  POST   /oauth/token
  GET    /oauth/userinfo
```

---

## System 3 — Forum

| Item | Detail |
|------|--------|
| Platform | Flarum (open source, PHP + MySQL) |
| Hosting | Existing VPS — isolated virtual host |
| Database | MySQL — **dedicated database**, not shared with other VPS sites |
| URL | `forum.[BRAND].com` |
| Theme | Custom CSS to match main site — warm white + dark brown + brick red |

### SSO Integration

Flarum uses the `fof/passport` plugin to authenticate against the Workers OAuth2 server.

```
User clicks "Join Forum" on main site
  → Already logged in to main site (has JWT)
  → Redirected to forum.[BRAND].com
  → Flarum redirects to api.[BRAND].com/oauth/authorize
  → Workers validates session → returns auth code
  → Flarum exchanges code for token
  → Flarum gets user info from /oauth/userinfo
  → Flarum creates or updates local user record
  → User is logged in to forum ✓
```

**One-way sync:** Main site is the identity provider. Forum users are created from main site accounts. Direct forum registration is also allowed — those users just won't have a main site account unless they sign up separately.

### Forum Categories

```
📌 Announcements        ← team posts only
💬 General Discussion   ← anything goes
⚙️  Hardware            ← PCB, PCBA, components, sourcing
💻 Firmware & Software  ← embedded, RTOS, connectivity
🔩 Mechanical           ← enclosures, 3D printing, DFM
🛠️  Dev Boards & SDK    ← our boards, SDK questions, show & tell
💡 Project Ideas        ← community brainstorming
🐛 Bug Reports          ← for our dev board / SDK issues
```

---

## Cost Summary

| Service | Free Tier | Est. Cost (Early Stage) |
|---------|-----------|------------------------|
| GitHub Pages | Unlimited (public repo) | $0 |
| Cloudflare Workers | 100K req/day | $0 |
| Cloudflare D1 | 5GB, 5M reads/day | $0 |
| Cloudflare R2 | 10GB, 1M writes/mo | $0 |
| VPS (Flarum) | — | $5–6/mo |
| **Total** | | **~$5–6/mo** |

When traffic grows, upgrade Workers to paid plan at $5/mo — D1 and R2 limits expand significantly.

---

## Deployment Flow

```
Main Site Changes:
  Edit HTML/CSS/JS locally
  → git push → GitHub Pages auto-deploys ✓

API Changes:
  Edit Workers code
  → wrangler deploy → live in seconds ✓

Forum Theme Changes:
  Edit Flarum custom CSS in admin panel
  → save → live immediately ✓

New Case Added:
  Admin logs into /admin
  → fill case form + upload photos
  → POST /cases → stored in D1 + R2
  → cases.html fetches via GET /cases ✓

Quote Submitted:
  Client fills /quote form (must be logged in)
  → files uploaded directly to R2 via presigned URL
  → form data POST to /quotes → stored in D1
  → admin gets email notification
  → admin replies via /dashboard
  → client sees status updates in their dashboard ✓
```

---

## Security Notes

- All API endpoints require JWT except public GET routes
- Admin routes verified by `role = admin` in D1 users table
- R2 buckets are private — all access via presigned URLs or Workers proxy
- Flarum database isolated — separate MySQL database, separate credentials
- HTTPS enforced everywhere (Cloudflare handles TLS for Workers, Let's Encrypt for VPS)
- File uploads: type validation + size limit (20MB) enforced in Workers before R2 write
