# rogersense — Hardware Solution Website

A professional English-language website for hardware + firmware + software + mechanical solution services.
Customers describe their needs → we evaluate → custom quote. **No fixed pricing.**

## Services
- ⚙️ Hardware Design (PCB / PCBA)
- 💻 Software Development (Embedded / App / Cloud)
- 🔩 Mechanical / Structural Design
- 🎨 Industrial Design (ID) — via partner

## Site Structure
| Page | Purpose |
|------|---------|
| `index.html` | Homepage — services overview + inline brief form |
| `cases.html` / `case-detail.html` | Case showcase — photos + descriptions, no pricing |
| `quote.html` | Submit a brief — 5-step request form (requires login) |
| `about.html` | About us |
| `login.html` | Login / Register (email+password + GitHub OAuth) |
| `dashboard.html` | Client dashboard — my briefs, status, messages |
| `admin.html` | Admin panel — manage briefs & cases |
| Forum | Flarum on VPS at `forum.[BRAND].com` (separate app, unified style) |

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
| Auth | bcrypt + dual JWT (client/admin) + GitHub OAuth |
| Hosting | VPS — Nginx reverse proxy + PM2; Cloudflare CDN/SSL in front |
| Forum | Flarum (PHP + dedicated MySQL), SSO via backend OAuth2 |

## Local development
```bash
npm install
cp .env.example .env   # fill in CF D1/R2 tokens, JWT secrets
node server.js         # serves frontend + API on http://localhost:PORT
```

## Deployment
Push to GitHub → on VPS: `git pull && pm2 restart [BRAND]` (see `ARCHITECTURE.md` → Deployment & Operations).

## Notes
- All public-facing content in English; admin UI may be bilingual.
- No standard pricing — all quotes are custom.
- `[BRAND]` placeholders are replaced once the brand name is finalized.

## Repository
`https://github.com/andrewljf001/rogersense`
