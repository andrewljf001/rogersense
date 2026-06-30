# rogersense — Hardware Solution Website

A professional English-language website for hardware + firmware + software + mechanical solution services.
Customers can submit custom briefs for evaluation and buy in-stock tools/products directly from the store.

## Services
- ⚙️ Hardware Design (PCB / PCBA)
- 💻 Software Development (Embedded / App / Cloud)
- 🔩 Mechanical / Structural Design
- 🎨 Industrial Design (ID) — via partner

## Site Structure
| Page | Purpose |
|------|---------|
| `/` | Homepage, services overview, cases preview, store/blog links |
| `/shop` / `/products/:slug` | Fixed-price store, product detail, downloads, reviews, PayPal checkout |
| `/cases` / `/cases/:slug` | Case showcase, photos and descriptions |
| `/blog` / `/blog/:slug` | Blog list and SSR article pages |
| `/quote` | Submit a custom brief (requires login) |
| `/about` | About us |
| `/contact` | Contact form plus sales/engineering WhatsApp lines |
| `/track` | Public order tracking |
| `/login` / `/reset` | Email/password auth and password reset |
| `/dashboard` | Client dashboard, briefs, messages, product orders |
| `/admin` | Admin panel for briefs, cases, products, orders, reviews, posts, settings |
| Legal pages | Privacy, terms, returns, shipping, GDPR deletion request |
| Forum | Flarum on VPS at `forum.rogersense.com` (separate app, unified style) |

## Architecture (summary)
**VPS runs stateless business logic; all data lives in Cloudflare.** See `ARCHITECTURE.md` for the full design.

```
Browser → Cloudflare CDN/SSL → VPS (Nginx) → Node.js + Express → Cloudflare D1 (DB) + R2 (files)
```

| Layer | Tech |
|-------|------|
| Frontend | Static HTML / CSS / JS — no build step (Deep Navy + Electric Teal theme) |
| Backend | Node.js + Express (`server.js` + `database.js`) |
| Database | Cloudflare D1 (SQLite) over HTTP REST API |
| File storage | Cloudflare R2 (S3-compatible) |
| Auth | bcrypt + JWT with role-based admin; GitHub OAuth is hidden until configured |
| Hosting | VPS — Nginx reverse proxy + PM2; Cloudflare CDN/SSL in front |
| Payments | PayPal checkout with PayPal/Card plus wallet integrations where eligible |
| Forum | Flarum (PHP + dedicated MySQL); SSO is deferred |

## Local development
Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env   # fill in CF D1/R2 tokens, JWT secrets
node server.js         # serves frontend + API on http://localhost:PORT
```

## Content publishing workbench
Rogersense publishing must use the site's admin API; do not publish by hand-editing D1, copying server files, browser-only upload workarounds, or temporary scripts.

```json
{
  "baseUrl": "https://rogersense.com",
  "publishMode": "admin-posts-api",
  "loginPath": "/auth/login",
  "postsPath": "/api/admin/posts",
  "imageUploadPath": "/api/admin/upload/image"
}
```

Blog cover uploads use `POST /api/admin/upload/image` with an admin JWT and `multipart/form-data` field `image` or `file`. The server converts the upload to WebP, stores only the WebP object in R2 under `products/blog/`, and returns `/img?key=...` for public display.

## Deployment
Deploy to the VPS app directory `/var/www/rogersense`, then restart PM2 process `rogersense`.
GitHub should remain the source of truth; do not copy `.env`, `node_modules`, or `logs`.

## Notes
- All public-facing content in English; admin UI may be bilingual.
- Custom briefs are quoted by the team; store products use fixed online pricing.
- `rogersense.com` is the canonical domain; `www.rogersense.com` redirects to it.

## Repository
`https://github.com/andrewljf001/rogersense`
