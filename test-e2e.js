#!/usr/bin/env node
/**
 * test-e2e.js — end-to-end API test against a local SQLite double.
 *
 *   node test-e2e.js   (or: npm test)
 *
 * Boots server.js with DB_DRIVER=sqlite (in-memory) + dummy R2 creds,
 * then exercises auth, quotes, messages, cases and upload presign,
 * asserting both happy paths and authorization rules.
 */
const { spawn } = require('node:child_process');

const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = 'admin@rogersense.com';
const ADMIN_PASS  = 'rogersense2026';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? '  — ' + extra : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy in time');
}

async function run() {
  // ── SEO routes ───────────────────────────────────────────
  const robots = await fetch(BASE + '/robots.txt');
  const robotsText = await robots.text();
  check('robots.txt → 200 text', robots.status === 200 && robotsText.includes('User-agent: *'));
  check('robots.txt declares sitemap', robotsText.includes('Sitemap: https://rogersense.com/sitemap.xml'));

  const sitemap = await fetch(BASE + '/sitemap.xml');
  const sitemapText = await sitemap.text();
  check('sitemap.xml → 200 XML urlset', sitemap.status === 200 && sitemapText.includes('<urlset'));
  check('sitemap.xml includes canonical home', sitemapText.includes('<loc>https://rogersense.com/</loc>'));

  const sitemapIndex = await fetch(BASE + '/sitemap_index.xml');
  const sitemapIndexText = await sitemapIndex.text();
  check('sitemap_index.xml → 200 XML index', sitemapIndex.status === 200 && sitemapIndexText.includes('<sitemapindex'));
  check('sitemap_index.xml points to sitemap.xml', sitemapIndexText.includes('<loc>https://rogersense.com/sitemap.xml</loc>'));

  // ── Auth ──────────────────────────────────────────────────
  const reg = await req('POST', '/auth/register', { body: { name: 'Jane Tester', email: 'jane@test.com', password: 'password123' } });
  check('register client → 200 + token', reg.status === 200 && !!reg.data?.token, `status=${reg.status}`);
  check('register sets role=client', reg.data?.user?.role === 'client');
  const clientToken = reg.data?.token;

  const dup = await req('POST', '/auth/register', { body: { name: 'x', email: 'jane@test.com', password: 'password123' } });
  check('duplicate email → 409', dup.status === 409, `status=${dup.status}`);

  const login = await req('POST', '/auth/login', { body: { email: 'jane@test.com', password: 'password123' } });
  check('login client → 200 + token', login.status === 200 && !!login.data?.token);

  const badLogin = await req('POST', '/auth/login', { body: { email: 'jane@test.com', password: 'wrong' } });
  check('wrong password → 401', badLogin.status === 401);

  const adminLogin = await req('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  check('seeded admin login → 200', adminLogin.status === 200, `status=${adminLogin.status}`);
  check('admin role=admin', adminLogin.data?.user?.role === 'admin');
  const adminToken = adminLogin.data?.token;

  const me = await req('GET', '/auth/me', { token: clientToken });
  check('GET /auth/me → user', me.status === 200 && me.data?.user?.email === 'jane@test.com');

  // ── Quotes ────────────────────────────────────────────────
  const noAuth = await req('GET', '/quotes');
  check('GET /quotes without token → 401', noAuth.status === 401);

  const submit = await req('POST', '/quotes', { token: clientToken, body: {
    disciplines: ['hardware', 'firmware'], deliverable: 'pcba',
    description: 'A battery IoT sensor with BLE and 6-month battery life.',
    files: [{ name: 'spec.pdf', key: 'quotes/123_spec.pdf', size: 2048 }],
    name: 'Jane Tester', email: 'jane@test.com', company: 'Acme',
  }});
  check('submit brief → 200 + id', submit.status === 200 && !!submit.data?.quote?.id, `status=${submit.status}`);
  const quoteId = submit.data?.quote?.id;

  const badSubmit = await req('POST', '/quotes', { token: clientToken, body: { disciplines: [], description: '' } });
  check('submit with no disciplines → 400', badSubmit.status === 400);

  const myQuotes = await req('GET', '/quotes', { token: clientToken });
  check('client lists own quotes (1)', myQuotes.status === 200 && myQuotes.data?.quotes?.length === 1);
  check('disciplines parsed to array', Array.isArray(myQuotes.data?.quotes?.[0]?.disciplines));

  const detail = await req('GET', `/quotes/${quoteId}`, { token: clientToken });
  check('client reads own quote', detail.status === 200 && detail.data?.quote?.id === quoteId);
  check('files parsed to array', Array.isArray(detail.data?.quote?.files) && detail.data.quote.files.length === 1);

  const clientPatch = await req('PATCH', `/quotes/${quoteId}/status`, { token: clientToken, body: { status: 'reviewing' } });
  check('client cannot change status → 403', clientPatch.status === 403);

  const adminPatch = await req('PATCH', `/quotes/${quoteId}/status`, { token: adminToken, body: { status: 'reviewing' } });
  check('admin changes status → 200', adminPatch.status === 200);

  const afterPatch = await req('GET', `/quotes/${quoteId}`, { token: clientToken });
  check('status now reviewing', afterPatch.data?.quote?.status === 'reviewing');

  const adminList = await req('GET', '/quotes', { token: adminToken });
  check('admin sees all quotes', adminList.status === 200 && adminList.data?.quotes?.length >= 1);

  const adminFiltered = await req('GET', '/quotes?status=quoted', { token: adminToken });
  check('admin status filter (none quoted)', adminFiltered.data?.quotes?.length === 0);

  // ── Messages ──────────────────────────────────────────────
  await req('POST', `/quotes/${quoteId}/messages`, { token: clientToken, body: { content: 'Any update?' } });
  await req('POST', `/quotes/${quoteId}/messages`, { token: adminToken, body: { content: 'Reviewing now.' } });
  const msgs = await req('GET', `/quotes/${quoteId}/messages`, { token: clientToken });
  check('thread has 2 messages', msgs.data?.messages?.length === 2, `got ${msgs.data?.messages?.length}`);
  check('message roles correct', msgs.data?.messages?.[0]?.role === 'client' && msgs.data?.messages?.[1]?.role === 'admin');

  // ── Cases ─────────────────────────────────────────────────
  const newCase = await req('POST', '/cases', { token: adminToken, body: {
    title: 'Smart Pet Door', slug: 'smart-pet-door', category: 'iot',
    tags: ['IoT', 'BLE'], description: 'BLE pet door.', cover_image: 'https://static/x.jpg',
    images: ['https://static/1.jpg'], published: true,
  }});
  check('admin creates case → 200', newCase.status === 200 && !!newCase.data?.case?.id);
  const caseId = newCase.data?.case?.id;

  const clientCase = await req('POST', '/cases', { token: clientToken, body: { title: 'x', slug: 'x' } });
  check('client cannot create case → 403', clientCase.status === 403);

  const pubCases = await req('GET', '/cases');
  check('public sees published case (1)', pubCases.status === 200 && pubCases.data?.cases?.length === 1);
  check('case tags parsed to array', Array.isArray(pubCases.data?.cases?.[0]?.tags));

  const oneCase = await req('GET', '/cases/smart-pet-door');
  check('GET case by slug', oneCase.status === 200 && oneCase.data?.case?.slug === 'smart-pet-door');

  await req('PATCH', `/cases/${caseId}`, { token: adminToken, body: { published: false } });
  const afterUnpub = await req('GET', '/cases');
  check('unpublished hidden from public (0)', afterUnpub.data?.cases?.length === 0);
  const adminCases = await req('GET', '/cases', { token: adminToken });
  check('admin still sees draft (1)', adminCases.data?.cases?.length === 1);

  // ── Upload presign ────────────────────────────────────────
  const presign = await req('POST', '/upload/presign', { token: clientToken, body: { filename: 'gerber.zip', contentType: 'application/zip', folder: 'quotes' } });
  check('presign → 200 + url + key', presign.status === 200 && /^https?:\/\//.test(presign.data?.url || '') && /^quotes\//.test(presign.data?.key || ''), `status=${presign.status}`);

  const presignNoAuth = await req('POST', '/upload/presign', { body: { filename: 'a.zip' } });
  check('presign without token → 401', presignNoAuth.status === 401);

  // /img public redirect — serves cases/ only, never private prefixes.
  const imgCase = await fetch(`${BASE}/img?key=cases/x.jpg`, { redirect: 'manual' });
  check('/img cases/ → 302 redirect', imgCase.status === 302);
  const imgQuote = await fetch(`${BASE}/img?key=quotes/secret.pdf`, { redirect: 'manual' });
  check('/img quotes/ → 403 (private blocked)', imgQuote.status === 403);
  const imgBackup = await fetch(`${BASE}/img?key=backups/d1/latest.json.gz`, { redirect: 'manual' });
  check('/img backups/ → 403 (private blocked)', imgBackup.status === 403);

  // ── Cleanup ───────────────────────────────────────────────
  const del = await req('DELETE', `/cases/${caseId}`, { token: adminToken });
  check('admin deletes case → 200', del.status === 200);
  const gone = await req('GET', '/cases', { token: adminToken });
  check('case removed (0)', gone.data?.cases?.length === 0);
}

(async () => {
  const child = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      SQLITE_PATH: ':memory:',
      PORT: String(PORT),
      JWT_SECRET: 'e2e-test-secret',
      DEFAULT_ADMIN_EMAIL: ADMIN_EMAIL,
      DEFAULT_ADMIN_PASSWORD: ADMIN_PASS,
      // Dummy R2 creds so presign can sign locally (no network).
      R2_ACCOUNT_ID: 'dummyacct',
      R2_ACCESS_KEY_ID: 'dummykey',
      R2_SECRET_ACCESS_KEY: 'dummysecret',
      R2_BUCKET: 'rogersense-test',
      // Ensure no real D1 creds leak in.
      CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_D1_DATABASE_ID: '', CLOUDFLARE_API_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErr = '';
  child.stderr.on('data', d => { serverErr += d; });

  let code = 1;
  try {
    await waitForHealth();
    console.log('\n🧪 rogersense E2E test\n');
    await run();
    console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
    code = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error('\n💥 Test harness error:', e.message);
    if (serverErr) console.error('--- server stderr ---\n' + serverErr);
    code = 1;
  } finally {
    child.kill('SIGKILL');
  }
  process.exit(code);
})();
