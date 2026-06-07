# Project Progress Tracker

> Last updated: 2026-06-06
> Repo: `andrewljf001/rogersense`
> Architecture: **VPS + Node/Express + Cloudflare D1 (HTTP) + R2** — see `ARCHITECTURE.md`

---

## 📍 Current State (2026-06-06, evening)

**Live & functional** on VPS (Contabo `147.93.182.13`, ssh `rogersense-vps`, dir `/var/www/rogersense`, pm2 `rogersense`). Site at rogersense.com (now behind **Cloudflare proxy / CDN**, Brotli on). Admin at **rogersense.com/admin**.

### Site map (nav + footer unified)
Home · How it works · Store · Cases · Blog · About · Contact · Forum. Footer = Explore / Company / Legal + Track Order + Terms. Pages: index, shop, product, cases, case-detail, blog, blog-post, about, contact, quote, track, login, dashboard, admin, privacy, returns, shipping, gdpr, terms, reset, 404 + favicon.

### 🛒 Store / e-commerce — payments LIVE
- Product list + **PDP** (`product.html?slug=` — gallery/thumbs/lightbox, summary, Description+Reviews tabs, responsive). Store "Buy" → PDP.
- **Login required to order** (no guest checkout). Checkout has **inline register/sign-in** (with Turnstile) → continue to shipping → pay. Orders tie to the account.
- **Wallet payments via PayPal SDK (LIVE):** **Apple Pay** (Safari/Apple) + **Google Pay** (Chrome/Android) + **PayPal** + **Card** — all through PayPal. Pay Later disabled. Endpoints: `/api/payment/create-order` + `/api/payment/capture-order`; redirect flow `/api/products/buy`+`/pay/product/return` kept as fallback. Apple Pay domain file at `/.well-known/apple-developer-merchantid-domain-association` (owner-provided). **Verified working end-to-end in sandbox; live creds valid.**
- **Orders + tracking**: admin **Orders** tab (status + `tracking_no`/`carrier`, Save → emails buyer on ship). Customer **My Orders** in dashboard. Public **track.html** (order# + email). `/me/product-orders`, `/api/orders/track`.
- **Reviews + moderation** (`product_reviews`): submit → pending → admin Reviews approve. Avg rating on card+PDP.
- Per-product downloads (R2 `products/`). Live product: **LiDAR S1** ($4999, live stock managed in DB, 3 photos, spec PDF).

### 📝 Blog + SEO
`posts`; blog list/detail; admin Blog editor. **SSR for posts** (meta/canonical/OG/JSON-LD). `/sitemap.xml` now includes public static pages plus published cases/products/posts; `/sitemap_index.xml` points to it; `/robots.txt` declares the index. 1 post live.

### 📁 Cases · 📞 Contact/WhatsApp · ⚖️ Legal/GDPR
- Cases incl. AMR LiDAR navigation case (SVG cover + S1 photos).
- Contact page + `POST /api/contact`; **dual WhatsApp** (sales 8618665860773 / engineer 8613923800205) + floating button. Address = **Lihao** Industrial Park, Longgang, Shenzhen.
- Privacy / Returns / Shipping / **Terms** / GDPR-deletion pages + **cookie consent banner**.

### 🔐 Security & accounts
- **Turnstile** live on contact/review/register/gdpr/**login** (both keys configured; enforced only when both set; auto-renew + reset, no stuck-spin).
- **Forgot/reset password**: `/auth/forgot-password` (emails link) → `reset.html` → `/auth/reset-password`. "Forgot password?" on login.
- GitHub OAuth is currently disabled in settings and hidden from the login/register UI until configured.
- Admin login fixed → lands on `/admin`. Custom 404 page.
- App sends baseline security headers, hides `X-Powered-By`, restricts CORS to known origins, and redirects `www.rogersense.com` to canonical `rogersense.com`.

### 📧 Email — WORKING
Zoho SMTP configured & verified: smtppro.zoho.com:465 SSL, user/from admin@rogersense.com, password set. Drives: brief alerts, contact form, payment confirmations, shipping notifications, password reset, GDPR.

### ⚡ Performance (this session)
- **In-memory cache** (30s) for `/api/products` + `/api/settings/public` → origin TTFB 0.3-0.8s → ~0ms (auto-invalidated on admin product/settings change).
- Static `/assets` cached 7d; HTML pages send `public, max-age=300, s-maxage=600` (sensitive pages `no-store`).
- Origin Node serves static in ~3-5ms; assets edge-cached (HIT). **US PageSpeed ~90.**

### ⏳ Owner action items / optional
1. **Edge-cache HTML for Asia speed** (optional): if latency becomes an issue, add a Cloudflare Cache Rule for non-`/api`/non-account paths with a short Edge TTL.
2. **Real $1 test purchase** via Apple Pay to confirm full live flow, then delete the test product.
3. Add more products / posts / cases.
4. Not done (deferred): Google/PayPal product-page SSR, email verification on register, analytics review, forum SSO, more content.

---

## 🔧 In Flight — PCBAForge Back-office Parity Port (started 2026-06-05)

> Goal (owner): rogersense admin **功能与框架** must match pcbaforge (style stays rogersense). Includes WhatsApp (back-office configurable + frontend display) and full PayPal payment port. Reference source pulled to `.pcbaforge-ref/` (gitignored).

> **Scope converged (owner, 2026-06-05):** keep current **single-JWT + role** auth and existing routes — do **NOT** swap to dual-JWT/admin_users and do **NOT** rename routes to /api (would force a frontend rewrite, which owner forbade). Frontend pages must not be rebuilt; only additive changes allowed (WhatsApp, one new Store page). Add a **Store** of fixed-price dev boards/tools with **direct PayPal purchase**; custom solutions remain brief-only. Dev resources live on product detail (downloads) + forum.

- [x] **DB layer** (`database.js`): `addresses`, `products`, `product_orders` tables; `users.whatsapp` + GDPR cols; `quotes` payment cols (`shipping_fee/total_paid/payment_intent`); settings (`whatsapp_number/engineer_whatsapp/contact_address/contact_hours/paypal_*`); idempotent migrations. (Reverted the admin_users/dual-JWT experiment per converged scope — role-based admin kept.)
- [x] **Admin endpoints** (`server.js`): `/api/admin/stats`, `/api/admin/admins` GET/POST + `/:id/password`, `/api/admin/gdpr/pending` + `delete-user`, public `/api/gdpr/delete-request`
- [x] **Customer addresses**: `/me/addresses` CRUD
- [x] **Payment (PayPal)**: `getPayPalConfig/Token`; `/api/payment/config`; admin `POST /quotes/:id/send-payment`; server-side redirect flow `GET /pay` + `/pay/return` (quotes) — no extra frontend page needed
- [x] **Store / products**: public `/api/products(+/:slug)`, admin products CRUD, `/api/admin/product-orders`, direct buy `POST /api/products/buy` → PayPal → `GET /pay/product/return` capture + stock decrement
- [x] **Uploads**: `/upload/presign` + `/img` extended to `products/` folder (images + public datasheets/SDK)
- [x] **shop.html** (NEW page): product grid, detail modal w/ downloads, checkout modal → PayPal redirect; Store added to its own nav/footer
- [x] **WhatsApp frontend**: floating wa.me button injected via `assets/main.js` on all public pages (reads `whatsapp_number`; hidden on admin; hidden if unset)
- [x] **Backend tested**: `DB_DRIVER=sqlite` E2E green (admin login, product CRUD, public list, shop.html 200, buy guarded by PayPal config, stats)
- [x] **admin.html UI** (back-office): Dashboard(stats) + GDPR pending list, Products management (image + datasheet/SDK upload), PayPal + WhatsApp + contact-address/hours setting fields, brief `send-payment` + quoted-price editor. Added `PATCH /quotes/:id` (admin price update).
- [x] **Nav discoverability**: `Store` link added to all pages' nav + drawer (additive one-liner)
- [x] **Deployed to VPS**: all files copied, initDB migrations ran on prod D1 (whatsapp/paypal settings + products/product_orders/addresses tables live), pm2 restarted, external smoke test green (rogersense.com + /shop.html = 200, Store link live)

### Owner action items (external — not code)
- [x] In admin → Settings → **Payments (PayPal)**: live client ID + secret + mode configured
- [x] In admin → Settings: WhatsApp numbers + contact address/hours configured
- [x] In admin → **Store**: first live product added with images and PDF download
- [x] In admin → Settings → Mail: Zoho SMTP configured and verified
- [ ] Run a real low-value live purchase test, then void/refund/clean up as needed

> Design note (owner, 2026-06-05): **Store products = direct buy/pay, no admin approval** (differs from pcbaforge). Custom briefs = submit-only, admin prices + sends pay link. Dev resources surfaced on product detail (downloads) + forum.

### Added after store (2026-06-05)
- [x] **Blog**: `posts` table; public `/api/posts(+/:slug)`; admin posts CRUD; `blog.html` + `blog-post.html`; admin Blog view (HTML editor + cover upload); `/sitemap.xml` (static + cases + products + posts). Nav `Blog` added site-wide.
- [x] **Contact**: `contact.html` (info cards + message form) + `POST /api/contact` (emails contact_email). Nav `Contact` added site-wide.
- [x] **Two contact lines** (mirrors pcbaforge): Sales `whatsapp_number` + Engineering `engineer_whatsapp` shown as separate cards.
- [x] **Contact settings seeded in prod D1** to match pcbaforge (email swapped to admin@rogersense.com): address = Lihao Industrial Park, Longgang, Shenzhen; hours = Mon–Sat 8am–9pm CST; WhatsApp sales 8618665860773 / engineer 8613923800205.
- All deployed + external smoke green (contact.html / blog.html / sitemap.xml = 200).

---

## 🗂 Phase Overview

| Phase | Name | Status |
|-------|------|--------|
| 0 | Planning & Architecture | ✅ Done |
| 1 | Main Site — Frontend (static pages) | ✅ Done |
| 2 | API Backend (Node/Express + D1 + R2) | ✅ Done (33/33 E2E tests pass on SQLite double) |
| 3 | Wire Frontend ↔ Backend | ✅ Done (deployed, same-origin) |
| 4 | VPS Deployment (Nginx + PM2 + CF + backups) | ✅ Live; SSL/proxy + D1/forum backups verified |
| 5 | Forum (Flarum + unified style + SSO) | 🔄 Flarum up, themed, backed up; SSO deferred |
| 6 | Brand Name & Domain | ✅ Rogersense / rogersense.com live |
| 7 | Polish, SEO & Launch | 🔄 Live; ongoing content, analytics, SSO, purchase QA |

---

## ✅ Phase 0 — Planning & Architecture

- [x] Business scope defined (HW / firmware / SW / mechanical; ID via partner)
- [x] Reference architecture studied: sister project PCBAForge (`CC-pcba-order-website`, live)
- [x] **Architecture revised** from Cloudflare Workers → VPS Node/Express + D1(HTTP) + R2
- [x] `ARCHITECTURE.md` rewritten to the new stack
- [x] D1 schema designed for rogersense domain (users, admin_users, quotes, messages, cases, settings)
- [x] API endpoint map defined
- [x] Deployment = VPS + Nginx + PM2 (confirmed by owner 2026-06-04)

---

## ✅ Phase 1 — Main Site Frontend

All 8 pages built with the locked Deep Navy + Electric Teal design system.

- [x] `assets/style.css` — global design system
- [x] `assets/main.js` — Auth + apiFetch + AuthAPI/QuotesAPI/MessagesAPI/CasesAPI/UploadAPI
- [x] `index.html` — homepage (hero, how-it-works, services, inline brief, cases preview, dev boards CTA)
- [x] `about.html` / `login.html` / `dashboard.html`
- [x] `quote.html` — 5-step brief form
- [x] `cases.html` / `case-detail.html` — with placeholder fallback when API offline
- [x] `admin.html` — quotes + cases management
- [x] Mobile responsive pass on `index.html`
- [ ] Field-name alignment with real backend payloads (done in Phase 3)

---

## ✅ Phase 2 — API Backend (Node/Express + D1 + R2)

- [x] `package.json` + deps (express, cors, jsonwebtoken, bcryptjs, multer, uuid, node-fetch, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, nodemailer, passport, passport-github2, dotenv)
- [x] `database.js` — D1 HTTP `query()` + `initDB()` (tables, seeds, migrations, default admin)
- [x] `server.js` — middleware, AES helpers, R2 client, multer, mail, JWT auth middlewares
- [x] Public: `/api/settings/public`, `POST /api/quotes`, `GET /api/cases`, `GET /api/cases/:slug`, `POST /api/quotes/lookup`
- [x] Client auth: register / login / github / verify / forgot+reset password
- [x] Client: `/api/me`(+password), `/api/me/quotes`, `/api/quotes/:id`, `/api/quotes/:id/messages`
- [x] Admin auth + `/api/admin/stats|quotes|quotes/:id|cases CRUD|settings`
- [x] File upload to R2 + presigned download
- [x] `.env.example` documented
- [x] `restore.js` / `scripts/backup-d1.js`
- [x] `ecosystem.config.js` (PM2: app + nightly backup cron)
- [ ] OAuth2 server endpoints for Flarum SSO (deferred to Phase 5)

---

## ✅ Phase 3 — Wire Frontend ↔ Backend

- [x] Same-origin API (served by Express on the VPS) — no separate `API_BASE` needed
- [x] Align response field names (e.g. `quotes` vs `briefs`, `case` shape, message roles)
- [x] Verify login → dashboard flow end to end
- [x] Verify brief submit (with file upload to R2) → appears in admin
- [x] Verify admin status update + reply → reflected in client dashboard
- [x] Verify cases CRUD in admin → renders on cases.html / case-detail.html
- [x] Keep visual style unchanged throughout

---

## 🔄 Phase 4 — VPS Deployment

> VPS: Contabo `147.93.182.13` (ssh alias `rogersense-vps`, port 26917, key `contabo_147_key`), shared with pcbaforge. App dir `/var/www/rogersense`.

- [x] Cloudflare: D1 database + R2 bucket (`rogersense-files`) provisioned; R2 put/get/delete verified
- [x] Run schema (initDB on first boot)
- [x] VPS: Node, Nginx, PM2 in place
- [x] Nginx vhost for `rogersense.com` → Node (see `deploy/rogersense.com.nginx`)
- [x] `.env` on VPS with secrets (D1 IDs + R2 keys set; never commit)
- [x] `pm2 start` + `pm2 save` (process `rogersense` online)
- [x] DNS A `rogersense.com` + `www` → VPS
- [x] Cloudflare proxy/CDN active; HTTPS working
- [x] SSL cert working on main site and forum
- [x] Daily D1 backup cron → R2 verified (`logs/backup-d1.log`)
- [x] Daily forum DB backup cron → R2 verified (`logs/backup-forum.log`)
- [x] SMTP (Zoho) configured and test mail sent
- [x] End-to-end read-only smoke test on production domain
- [ ] 📱 Notify owner when fully live

---

## 🔄 Phase 5 — Forum (Flarum + SSO)

> Forum dir `/var/www/rogersense-forum`; MariaDB 10.6 @127.0.0.1:3306, DB user `rogersense_forum@localhost` (isolated from erpnext/diyinai/ccpcba DBs).

- [x] Deploy Flarum on VPS (isolated vhost + dedicated MariaDB DB)
- [x] Custom CSS theme matching main site (Deep Navy + Electric Teal) — `deploy/forum-theme.less` + header/footer
- [x] Extensions enabled (bbcode, emoji, flags, likes, lock, markdown, mentions, nicknames, statistics, sticky, subscriptions, suspend, tags, lang-english)
- [x] `forum.rogersense.com` vhost live with DNS + SSL
- [ ] Install `fof/passport`, point at Express OAuth2 server (SSO — backend OAuth2 endpoints not built yet)
- [ ] Test SSO end to end
- [x] Forum DB daily mysqldump → R2
- [ ] Forum avatars/attachments → R2 (currently local disk)

---

## ✅ Phase 6 — Brand Name & Domain

- [x] Finalize brand name: Rogersense
- [x] Register / point domain: `rogersense.com`
- [x] Configure custom domain + subdomains in Cloudflare

---

## 🔄 Phase 7 — Polish, SEO & Launch

- [x] Meta / Open Graph tags, favicon, dynamic sitemap.xml, sitemap_index.xml + robots.txt
- [x] Email notifications on brief submission, contact, payment, shipping, reset, GDPR
- [x] Turnstile on auth + public forms
- [x] Read-only production QA on public pages, APIs, R2 assets, SEO files and backups
- [ ] Full browser visual QA on multiple devices
- [ ] Low-value live payment test
- [ ] Final content review → go live 🚀

---

## 📝 Change Log

| Date | Action | By |
|------|--------|-----|
| 2026-06-02 | Repo + initial docs; full frontend built | Claude + andrewljf001 |
| 2026-06-04 | Studied live sister project; **revised architecture to VPS+Node/Express+D1(HTTP)+R2** | Claude + andrewljf001 |
| 2026-06-04 | Rewrote ARCHITECTURE.md & PROGRESS.md; corrected repo name; designed rogersense D1 schema + API | Claude |
| 2026-06-04 | Built Node/Express backend (D1 HTTP + R2 presign + backup/restore); wired frontend (same-origin) | Claude |
| 2026-06-04 | Added local SQLite test double (node:sqlite) + E2E suite — 33/33 passing | Claude |
| 2026-06-04 | Deployed to Contabo VPS (`/var/www/rogersense`, pm2 + nginx); provisioned CF D1 + R2 (verified); DNS A records (grey); Flarum forum stood up + themed + extensions | Claude + andrewljf001 |
| 2026-06-05 | Verified VPS live (root/admin 200); confirmed admin back-office + mail-config UI complete; mail SMTP still unconfigured (owner setting up Zoho separately); refreshed PROGRESS to real state | Claude |
| 2026-06-06 | Synced production site code back into the repo workspace; added sitemap index, expanded sitemap static pages, hid disabled GitHub OAuth UI, added baseline security headers + canonical www redirect; verified public pages/APIs/resources/backups | Codex |
