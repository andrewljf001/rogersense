# Project Progress Tracker

> Last updated: 2026-06-04
> Repo: `andrewljf001/rogersense`
> Architecture: **VPS + Node/Express + Cloudflare D1 (HTTP) + R2** — see `ARCHITECTURE.md`

---

## 🗂 Phase Overview

| Phase | Name | Status |
|-------|------|--------|
| 0 | Planning & Architecture | ✅ Done |
| 1 | Main Site — Frontend (static pages) | ✅ Done (wired to API, awaiting backend) |
| 2 | API Backend (Node/Express + D1 + R2) | ⏳ In progress |
| 3 | Wire Frontend ↔ Backend | ⏳ Pending |
| 4 | VPS Deployment (Nginx + PM2 + CF + backups) | ⏳ Pending |
| 5 | Forum (Flarum + unified style + SSO) | ⏳ Pending |
| 6 | Brand Name & Domain | ⏳ Pending |
| 7 | Polish, SEO & Launch | ⏳ Pending |

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

## ⏳ Phase 2 — API Backend (Node/Express + D1 + R2)

- [ ] `package.json` + deps (express, cors, jsonwebtoken, bcryptjs, multer, uuid, node-fetch, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, nodemailer, passport, passport-github2, dotenv)
- [ ] `database.js` — D1 HTTP `query()` + `initDB()` (tables, seeds, migrations, default admin)
- [ ] `server.js` — middleware, AES helpers, R2 client, multer, mail, JWT auth middlewares
- [ ] Public: `/api/settings/public`, `POST /api/quotes`, `GET /api/cases`, `GET /api/cases/:slug`, `POST /api/quotes/lookup`
- [ ] Client auth: register / login / github / verify / forgot+reset password
- [ ] Client: `/api/me`(+password), `/api/me/quotes`, `/api/quotes/:id`, `/api/quotes/:id/messages`
- [ ] Admin auth + `/api/admin/stats|quotes|quotes/:id|cases CRUD|settings`
- [ ] File upload to R2 + presigned download
- [ ] `.env.example` documented
- [ ] `backup.js` / `restore.js` / `scripts/backup-d1.js`
- [ ] `ecosystem.config.js` (PM2: app + nightly backup cron)
- [ ] OAuth2 server endpoints for Flarum SSO (can defer to Phase 5)

---

## ⏳ Phase 3 — Wire Frontend ↔ Backend

- [ ] Set `API_BASE` in `assets/main.js` to the real API origin
- [ ] Align response field names (e.g. `quotes` vs `briefs`, `case` shape, message roles)
- [ ] Verify login → dashboard flow end to end
- [ ] Verify brief submit (with file upload to R2) → appears in admin
- [ ] Verify admin status update + reply → reflected in client dashboard
- [ ] Verify cases CRUD in admin → renders on cases.html / case-detail.html
- [ ] Keep visual style unchanged throughout

---

## ⏳ Phase 4 — VPS Deployment

> Needs owner-provided credentials: Cloudflare API token (DNS + D1 + R2) and VPS SSH access.

- [ ] Cloudflare: create D1 database (US), create R2 bucket (US), API tokens
- [ ] Run schema (initDB on first boot)
- [ ] VPS: Node 18+, Nginx, PM2, Certbot
- [ ] Nginx vhost for `[BRAND].com` → Node; SSL via Let's Encrypt
- [ ] `.env` on VPS with all secrets
- [ ] `pm2 start ecosystem.config.js && pm2 save && pm2 startup`
- [ ] DNS via Cloudflare → VPS (proxied)
- [ ] Daily backup cron verified (D1 → R2)
- [ ] End-to-end smoke test on production
- [ ] 📱 Notify owner by phone when live

---

## ⏳ Phase 5 — Forum (Flarum + SSO)

- [ ] Deploy Flarum on VPS (isolated vhost + dedicated MySQL DB)
- [ ] Custom CSS theme matching main site (Deep Navy + Electric Teal — unified, not a new palette)
- [ ] Configure categories
- [ ] Install `fof/passport`, point at Express OAuth2 server
- [ ] Test SSO end to end
- [ ] `forum.[BRAND].com` subdomain + nav link from main site

---

## ⏳ Phase 6 — Brand Name & Domain

- [ ] Finalize brand name (replaces `[BRAND]` placeholders site-wide)
- [ ] Register / point domain
- [ ] Configure custom domain + subdomains in Cloudflare

---

## ⏳ Phase 7 — Polish, SEO & Launch

- [ ] Meta / Open Graph tags, favicon, dynamic sitemap.xml + robots.txt
- [ ] Email notifications on brief submission (SMTP or Resend, configurable)
- [ ] Turnstile on auth + brief forms
- [ ] Cross-browser + mobile QA
- [ ] Final content review → go live 🚀

---

## 📝 Change Log

| Date | Action | By |
|------|--------|-----|
| 2026-06-02 | Repo + initial docs; full frontend built | Claude + andrewljf001 |
| 2026-06-04 | Studied live sister project; **revised architecture to VPS+Node/Express+D1(HTTP)+R2** | Claude + andrewljf001 |
| 2026-06-04 | Rewrote ARCHITECTURE.md & PROGRESS.md; corrected repo name; designed rogersense D1 schema + API | Claude |
