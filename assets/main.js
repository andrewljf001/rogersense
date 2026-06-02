/* ============================================================
   [BRAND] — API Client & Shared Utilities
   Connects to Cloudflare Workers backend
   ============================================================ */

const API_BASE = 'https://api.[BRAND].com'; // replace after deploy

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
    window.location.href = '/login.html';
  }
};

/* ── Fetch wrapper ── */
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) { Auth.logout(); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

/* ── Auth API ── */
const AuthAPI = {
  async register(name, email, password) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    return data;
  },
  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
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
    return apiFetch(`/cases${q}`);
  },
  async get(slug) {
    return apiFetch(`/cases/${slug}`);
  },
  async create(payload) {
    return apiFetch('/cases', { method: 'POST', body: JSON.stringify(payload) });
  },
  async update(id, payload) {
    return apiFetch(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async remove(id) {
    return apiFetch(`/cases/${id}`, { method: 'DELETE' });
  }
};

/* ── File Upload (R2 presigned) ── */
const UploadAPI = {
  async upload(file, folder = 'quotes') {
    // 1. Get presigned URL from Workers
    const { url, key } = await apiFetch('/upload/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, folder })
    });
    // 2. PUT directly to R2
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    return { key, name: file.name, size: file.size };
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
      <a href="/dashboard.html" class="nav-user" title="Dashboard">
        <div class="nav-avatar">${initials}</div>
        <span class="hidden sm-inline">${user.name || user.email}</span>
      </a>
      <button class="btn btn-outline btn-sm" onclick="Auth.logout()">Sign out</button>
    `;
  } else {
    actionsEl.innerHTML = `
      <a href="/login.html" class="btn btn-outline btn-sm">Sign in</a>
      <a href="/quote.html" class="btn btn-primary btn-sm">Submit Brief →</a>
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
    window.location.href = `/login.html?redirect=${encodeURIComponent(location.pathname)}`;
  }
}

/* ── Redirect if not admin ── */
function requireAdmin() {
  const user = Auth.getUser();
  if (!user || user.role !== 'admin') {
    window.location.href = '/';
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

/* ── Init on every page ── */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initMobileNav();
});
