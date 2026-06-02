# Project Progress Tracker

> Last updated: 2026-06-02  
> Repo: `andrewljf001/hw-solution-site` (Private)

---

## 🗂 Phase Overview

| Phase | Name | Status |
|-------|------|--------|
| 0 | Planning & Architecture | ✅ Done |
| 1 | API Backend (Cloudflare Workers) | ⏳ Pending |
| 2 | Main Site — Core Pages | ⏳ Pending |
| 3 | User Auth & Dashboard | ⏳ Pending |
| 4 | Quote Form + File Upload | ⏳ Pending |
| 5 | Case Showcase & Admin Panel | ⏳ Pending |
| 6 | Forum (Flarum + SSO) | ⏳ Pending |
| 7 | Brand Name & Domain | ⏳ Pending |
| 8 | Polish, SEO & Launch | ⏳ Pending |

---

## ✅ Phase 0 — Planning & Architecture

### Project Setup
- [x] Define business scope (HW / SW / Mechanical, ID outsourced)
- [x] Reference sites reviewed: pcbaforge.com, eesaz.com, softeq.com, particle.io
- [x] Create private GitHub repo: `hw-solution-site`
- [x] Write README.md
- [x] Write PROGRESS.md
- [x] Draft Claude Project Instructions

### Design Decisions
- [x] Visual style confirmed: warm off-white + dark brown-black + brick red accent, light editorial feel
- [x] Quote form design confirmed: 4-step (disciplines → deliverable → description → file upload)
- [x] Cases page: category tabs (IoT / Industrial / Consumer / Dev Boards) + card grid
- [x] Forum tool selected: **Flarum** on VPS (isolated MySQL DB)
- [x] Developer community: **GitHub Discussions** (bound to dev board repo)

### Architecture Decisions
- [x] Main site: **GitHub Pages** (static HTML/CSS/JS) — see `ARCHITECTURE.md`
- [x] API backend: **Cloudflare Workers** + **D1** (SQLite) + **R2** (file storage)
- [x] User auth: **better-auth** (email+password + GitHub OAuth, JWT)
- [x] Forum: **Flarum** on VPS, isolated database, SSO via Workers OAuth2 server
- [x] Data isolation: main site data in CF D1/R2, forum data in VPS MySQL — no shared DB
- [x] SSO flow: main site is OAuth2 provider → Flarum uses `fof/passport` to authenticate
- [x] System architecture documented: `ARCHITECTURE.md`

---

## ⏳ Phase 1 — API Backend (Cloudflare Workers)

> Repo to create: `andrewljf001/hw-solution-api`

- [ ] Init Cloudflare Workers project (Wrangler + TypeScript)
- [ ] Create D1 database + run schema migrations
- [ ] Create R2 bucket
- [ ] Implement better-auth (email/password + GitHub OAuth)
- [ ] Auth endpoints: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- [ ] OAuth2 server endpoints (for Flarum SSO): `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`
- [ ] Quote endpoints: POST/GET `/quotes`, GET/PATCH `/quotes/:id`
- [ ] Message endpoints: GET/POST `/quotes/:id/messages`
- [ ] File upload: POST `/upload/presign` (R2 presigned URL)
- [ ] Cases endpoints: public GET, admin POST/PATCH/DELETE
- [ ] Deploy to Cloudflare, bind custom domain `api.[BRAND].com`

---

## ⏳ Phase 2 — Main Site Core Pages

- [ ] `assets/style.css` — Global design system (colors, typography, spacing, components)
- [ ] `assets/main.js` — Shared scripts (nav, auth state, API client)
- [ ] `index.html` — Homepage (hero, how it works, services, cases preview, dev boards CTA)
- [ ] `about.html` — About the team
- [ ] `login.html` — Login / Register page
- [ ] `dashboard.html` — User dashboard (quote list + status)

---

## ⏳ Phase 3 — User Auth & Dashboard

- [ ] Login / register UI connected to Workers API
- [ ] JWT stored in httpOnly cookie or localStorage
- [ ] Auth state reflected in nav (show avatar / logout when logged in)
- [ ] `/dashboard` — list user's quotes with status badges
- [ ] `/dashboard/quote/:id` — quote detail + message thread + file list

---

## ⏳ Phase 4 — Quote Form + File Upload

- [ ] `quote.html` — Full quote request form (requires login)
- [ ] Step 1: discipline multi-select cards (Hardware / Firmware / Software / Mechanical / ID)
- [ ] Step 2: deliverable selector (PCBA / Product / Prototype / Unsure)
- [ ] Step 3: free-text description
- [ ] Step 4: file upload (drag & drop → R2 via presigned URL, up to 20MB)
- [ ] Contact fields: name + email (pre-filled if logged in)
- [ ] Homepage simplified inline version of the form
- [ ] Admin: view all quotes, update status, upload quote PDFs, reply to messages

---

## ⏳ Phase 5 — Case Showcase & Admin Panel

- [ ] `cases.html` — Case listing with category tab filter
- [ ] `case-detail.html` — Single case: cover photo, gallery, description, tags
- [ ] `admin.html` — Admin panel: create/edit/delete cases, upload photos to R2
- [ ] Cases data served from Workers GET `/cases`

---

## ⏳ Phase 6 — Forum (Flarum + SSO)

- [ ] Deploy Flarum on VPS (isolated virtualhost + dedicated MySQL DB)
- [ ] Install custom CSS theme (match main site: warm white + dark brown + brick red)
- [ ] Configure categories (Announcements / General / Hardware / Firmware / Mechanical / Dev Boards / Show & Tell / Bug Reports)
- [ ] Install `fof/passport` plugin
- [ ] Configure SSO: point Flarum at Workers OAuth2 server
- [ ] Test SSO flow end-to-end
- [ ] Set up `forum.[BRAND].com` subdomain
- [ ] Link forum from main site nav

---

## ⏳ Phase 7 — Brand Name & Domain

- [ ] Finalize brand/site name (business-driven, not company name)
- [ ] Replace all `[BRAND]` placeholders across all files
- [ ] Register domain
- [ ] Configure GitHub Pages custom domain (`[BRAND].com`)
- [ ] Configure Cloudflare for `api.[BRAND].com` and `forum.[BRAND].com`

---

## ⏳ Phase 8 — Polish, SEO & Launch

- [ ] Meta tags / Open Graph for all pages
- [ ] Favicon + logo (SVG)
- [ ] Mobile responsiveness check
- [ ] Cross-browser test (Chrome / Safari / Firefox)
- [ ] Email notifications on quote submission (Workers + Resend or Mailgun)
- [ ] Final content review
- [ ] Go live 🚀

---

## 📝 Change Log

| Date | Action | By |
|------|--------|-----|
| 2026-06-02 | Repo created, README + PROGRESS added | Claude + andrewljf001 |
| 2026-06-02 | Architecture fully designed and documented | Claude + andrewljf001 |
| 2026-06-02 | ARCHITECTURE.md created | Claude |
| 2026-06-02 | PROGRESS.md updated with full phase plan | Claude |
