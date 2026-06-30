/* ============================================================
   [BRAND] — API Client & Shared Utilities
   Connects to Cloudflare Workers backend
   ============================================================ */

// Same-origin: the Node/Express server serves both the frontend and the API.
// Override to a full origin (e.g. 'https://api.rogersense.com') only if you
// split the API onto a separate host.
const API_BASE = '';

/* ── Token helpers ── */
const Auth = {
  getToken:    () => localStorage.getItem('token'),
  setToken:    (t) => localStorage.setItem('token', t),
  removeToken: () => localStorage.removeItem('token'),
  getUser:     () => JSON.parse(localStorage.getItem('user') || 'null'),
  setUser:     (u) => localStorage.setItem('user', JSON.stringify(u)),
  removeUser:  () => localStorage.removeItem('user'),
  isLoggedIn:  () => !!localStorage.getItem('token'),
  logout() {
    this.removeToken();
    this.removeUser();
    window.location.href = '/login';
  }
};

/* ── Fetch wrapper ── */
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) { Auth.logout(); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

/* ── Auth API ── */
const AuthAPI = {
  async register(name, email, password, cf_turnstile) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, cf_turnstile })
    });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    return data;
  },
  async login(email, password, cf_turnstile) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, cf_turnstile })
    });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    return data;
  },
  async me() {
    return apiFetch('/auth/me');
  },
  githubLogin() {
    window.location.href = `${API_BASE}/auth/github`;
  }
};

/* ── Quotes API ── */
const QuotesAPI = {
  async submit(payload) {
    return apiFetch('/quotes', { method: 'POST', body: JSON.stringify(payload) });
  },
  async list() {
    return apiFetch('/quotes');
  },
  async get(id) {
    return apiFetch(`/quotes/${id}`);
  },
  async updateStatus(id, status) {
    return apiFetch(`/quotes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }
};

/* ── Messages API ── */
const MessagesAPI = {
  async list(quoteId) {
    return apiFetch(`/quotes/${quoteId}/messages`);
  },
  async send(quoteId, content, attachments = []) {
    return apiFetch(`/quotes/${quoteId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachments })
    });
  }
};

/* ── Cases API ── */
const CasesAPI = {
  async list(category = '') {
    const q = category ? `?category=${category}` : '';
    return apiFetch(`/api/cases${q}`);
  },
  async get(slug) {
    return apiFetch(`/api/cases/${slug}`);
  },
  async create(payload) {
    return apiFetch('/api/cases', { method: 'POST', body: JSON.stringify(payload) });
  },
  async update(id, payload) {
    return apiFetch(`/api/cases/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async remove(id) {
    return apiFetch(`/api/cases/${id}`, { method: 'DELETE' });
  }
};

/* ── File Upload (R2 presigned) ── */
const UploadAPI = {
  async upload(file, folder = 'quotes') {
    // 1. Get a presigned PUT URL from the API
    const { url, key, publicUrl } = await apiFetch('/upload/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, folder })
    });
    // 2. PUT the file directly to R2
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    // `url` (publicUrl) is for rendering (e.g. case images); `key` is the
    // private storage reference (e.g. quote attachments).
    return { key, url: publicUrl || key, name: file.name, size: file.size };
  },
  async uploadAdminImage(file) {
    const token = Auth.getToken();
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${API_BASE}/api/admin/upload/image`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: form,
    });
    if (res.status === 401) { Auth.logout(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
    return { ...data, name: file.name, size: file.size };
  }
};

/* ── Nav: render auth state ── */
function initNav() {
  const actionsEl = document.getElementById('nav-actions');
  if (!actionsEl) return;
  const user = Auth.getUser();
  if (user && Auth.isLoggedIn()) {
    const initials = user.name ? user.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?';
    actionsEl.innerHTML = `
      <a href="/dashboard" class="nav-user" title="Dashboard">
        <div class="nav-avatar">${initials}</div>
        <span class="hidden sm-inline">${user.name || user.email}</span>
      </a>
      <button class="btn btn-outline btn-sm" onclick="Auth.logout()">Sign out</button>
    `;
  } else {
    actionsEl.innerHTML = `
      <a href="/login" class="btn btn-outline btn-sm">Sign in</a>
      <a href="/quote" class="btn btn-primary btn-sm">Submit Brief →</a>
    `;
  }
}

/* ── Mobile nav drawer ── */
function initMobileNav() {
  const hamburger = document.getElementById('hamburger');
  const drawer    = document.getElementById('nav-drawer');
  const overlay   = document.getElementById('drawer-overlay');
  const closeBtn  = document.getElementById('drawer-close');
  if (!hamburger || !drawer) return;
  hamburger.addEventListener('click', () => drawer.classList.add('open'));
  overlay?.addEventListener('click', () => drawer.classList.remove('open'));
  closeBtn?.addEventListener('click', () => drawer.classList.remove('open'));
}

/* ── Toast notifications ── */
function showToast(message, type = 'success', duration = 3000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/* ── Redirect if not logged in ── */
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
  }
}

/* ── Redirect if not admin ── */
function requireAdmin() {
  if (!Auth.isLoggedIn()) {
    window.location.href = '/login?redirect=' + encodeURIComponent(location.pathname);
    return;
  }
  const user = Auth.getUser();
  if (!user || user.role !== 'admin') {
    window.location.href = '/dashboard';   // logged-in non-admins go to their dashboard
  }
}

/* ── Format helpers ── */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return String(value || ''); }
}
function cleanInternalLinks(html = '') {
  const pages = {
    shop: '/shop', cases: '/cases', blog: '/blog', about: '/about', quote: '/quote',
    contact: '/contact', privacy: '/privacy', terms: '/terms', returns: '/returns',
    shipping: '/shipping', gdpr: '/gdpr', login: '/login', dashboard: '/dashboard',
    reset: '/reset', track: '/track', admin: '/admin'
  };
  let out = String(html);
  out = out.replace(/https:\/\/rogersense\.com\/product\.html\?slug=([^"'&<>\s]+)/g, (_, slug) => `https://rogersense.com/products/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/https:\/\/rogersense\.com\/case-detail\.html\?slug=([^"'&<>\s]+)/g, (_, slug) => `https://rogersense.com/cases/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/https:\/\/rogersense\.com\/blog-post\.html\?slug=([^"'&<>\s]+)/g, (_, slug) => `https://rogersense.com/blog/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/(["'=])\/?product\.html\?slug=([^"'&<>\s]+)/g, (_, q, slug) => `${q}/products/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/(["'=])\/?case-detail\.html\?slug=([^"'&<>\s]+)/g, (_, q, slug) => `${q}/cases/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/(["'=])\/?blog-post\.html\?slug=([^"'&<>\s]+)/g, (_, q, slug) => `${q}/blog/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/(["'=])\/?cases\.html\?category=([^"'&<>\s]+)/g, (_, q, cat) => `${q}/cases/category/${encodeURIComponent(safeDecode(cat))}`);
  out = out.replace(/(["'=])\/?shop\.html\?category=([^"'&<>\s]+)/g, (_, q, cat) => `${q}/shop/category/${encodeURIComponent(safeDecode(cat))}`);
  out = out.replace(/(["'=])\/?shop\.html\?p=([^"'&<>\s]+)/g, (_, q, slug) => `${q}/products/${encodeURIComponent(safeDecode(slug))}`);
  out = out.replace(/(["'=])\/?shop\?p=([^"'&<>\s]+)/g, (_, q, slug) => `${q}/products/${encodeURIComponent(safeDecode(slug))}`);
  for (const [name, clean] of Object.entries(pages)) {
    out = out.replace(new RegExp(`(["'=])/?${name}\\.html`, 'g'), `$1${clean}`);
    out = out.replace(new RegExp(`https://rogersense\\.com/${name}\\.html`, 'g'), `https://rogersense.com${clean}`);
  }
  return out;
}

/* ── Status label helper ── */
const STATUS_LABELS = {
  pending:    'Pending Review',
  reviewing:  'Under Review',
  quoted:     'Quote Ready',
  confirmed:  'Confirmed',
  production: 'In Production',
  completed:  'Completed',
  cancelled:  'Cancelled'
};
function statusBadge(status) {
  return `<span class="status-badge status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

/* ── Floating WhatsApp contact button ──
   Injected on every public page (not admin). Shows only when an admin has
   set `whatsapp_number` in Settings. Reads from /api/settings/public. */
async function initWhatsApp() {
  if (location.pathname === '/admin') return;
  if (document.getElementById('wa-float')) return;
  try {
    const cfg = await apiFetch('/api/settings/public');
    const num = (cfg && (cfg.whatsapp_number || '')).replace(/[^0-9]/g, '');
    if (!num) return;
    const a = document.createElement('a');
    a.id = 'wa-float';
    a.href = `https://wa.me/${num}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Chat on WhatsApp';
    a.setAttribute('aria-label', 'Chat on WhatsApp');
    a.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:900;width:56px;height:56px;border-radius:50%;' +
      'background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25);' +
      'transition:transform .15s;';
    a.onmouseenter = () => a.style.transform = 'scale(1.08)';
    a.onmouseleave = () => a.style.transform = 'scale(1)';
    a.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.449L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.82 9.82 0 001.515 5.26l-.999 3.648 3.984-1.045zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z"/></svg>';
    document.body.appendChild(a);
  } catch (_) { /* settings not reachable — skip */ }
}

/* ── Public settings (cached) ── */
let _publicSettings = null;
async function getPublicSettings() {
  if (_publicSettings) return _publicSettings;
  try { _publicSettings = await apiFetch('/api/settings/public'); } catch { _publicSettings = {}; }
  return _publicSettings;
}

/* ── Cloudflare Turnstile (human verification) ──
   Renders only if a site key is configured. Auto-renews the token on idle
   forms (refresh-expired:auto) and exposes reset() so a failed submit can
   re-challenge instead of getting stuck. */
let _tsScript = null;
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (_tsScript) return _tsScript;
  _tsScript = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true; s.onload = () => res();
    document.head.appendChild(s);
  });
  return _tsScript;
}
async function mountTurnstile(el) {
  if (!el) return false;
  const cfg = await getPublicSettings();
  const sitekey = cfg.turnstile_site_key;
  if (!sitekey) { el.style.display = 'none'; return false; }
  await loadTurnstileScript();
  await new Promise(r => { const t = setInterval(() => { if (window.turnstile) { clearInterval(t); r(); } }, 50); setTimeout(() => { clearInterval(t); r(); }, 6000); });
  if (!window.turnstile) return false;
  el.style.display = '';
  try {
    el._ts = window.turnstile.render(el, { sitekey, 'refresh-expired': 'auto', theme: 'auto',
      'error-callback': () => { try { window.turnstile.reset(el._ts); } catch (_) {} } });
  } catch (_) { return false; }
  return true;
}
function turnstileToken(el) {
  try { return el && el._ts != null && window.turnstile ? window.turnstile.getResponse(el._ts) : ''; } catch { return ''; }
}
function turnstileReset(el) {
  try { if (el && el._ts != null && window.turnstile) window.turnstile.reset(el._ts); } catch {}
}

/* ── Cookie consent banner (GDPR) ── */
function initCookieBanner() {
  if (location.pathname === '/admin' || location.pathname === '/login') return;
  if (localStorage.getItem('cookie_consent')) return;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:940;max-width:720px;margin:0 auto;' +
    'background:#0f2231;color:#e6f6f2;border:1px solid #1b3a4b;border-radius:12px;padding:14px 18px;' +
    'display:flex;gap:14px;align-items:center;flex-wrap:wrap;box-shadow:0 12px 34px rgba(0,0,0,.45);';
  bar.innerHTML = '<span style="flex:1;min-width:220px;font-size:.84rem;line-height:1.5;">We use cookies to run the site and improve your experience. See our <a href="/privacy" style="color:#2dd4bf;font-weight:600;">Privacy Policy</a>.</span>' +
    '<button class="btn btn-primary btn-sm" data-ck="accepted">Accept</button>' +
    '<button class="btn btn-outline btn-sm" data-ck="rejected">Reject</button>';
  document.body.appendChild(bar);
  bar.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => {
    localStorage.setItem('cookie_consent', b.dataset.ck); bar.remove();
  }));
}

/* ── Init on every page ── */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initMobileNav();
  initWhatsApp();
  initCookieBanner();
});
