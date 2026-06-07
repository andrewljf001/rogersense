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
| `index.html` | Homepage, services overview, cases preview, store/blog links |
| `shop.html` / `product.html` | Fixed-price store, product detail, downloads, reviews, PayPal checkout |
| `cases.html` / `case-detail.html` | Case showcase, photos and descriptions |
| `blog.html` / `blog-post.html` | Blog list and SSR article pages |
| `quote.html` | Submit a custom brief (requires login) |
| `about.html` | About us |
| `contact.html` | Contact form plus sales/engineering WhatsApp lines |
| `track.html` | Public order tracking |
| `login.html` / `reset.html` | Email/password auth and password reset |
| `dashboard.html` | Client dashboard, briefs, messages, product orders |
| `admin.html` | Admin panel for briefs, cases, products, orders, reviews, posts, settings |
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
```bash
npm install
cp .env.example .env   # fill in CF D1/R2 tokens, JWT secrets
node server.js         # serves frontend + API on http://localhost:PORT
```

## Deployment
Deploy to the VPS app directory `/var/www/rogersense`, then restart PM2 process `rogersense`.
GitHub should remain the source of truth; do not copy `.env`, `node_modules`, or `logs`.

## Notes
- All public-facing content in English; admin UI may be bilingual.
- Custom briefs are quoted by the team; store products use fixed online pricing.
- `rogersense.com` is the canonical domain; `www.rogersense.com` redirects to it.

## Repository
`https://github.com/andrewljf001/rogersense`
