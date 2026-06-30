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
const http = require('node:http');

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
async function uploadAdminImage(token, fieldName = 'image') {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
  const form = new FormData();
  form.append(fieldName, new Blob([png], { type: 'image/png' }), 'pixel.png');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(BASE + '/api/admin/upload/image', { method: 'POST', headers, body: form });
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

function requestWithHost(path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, headers: { Host: host } }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  // ── Public SEO/security routes ───────────────────────────
  const health = await fetch(BASE + '/health');
  check('security: x-powered-by hidden', !health.headers.has('x-powered-by'));
  check('security: nosniff header set', health.headers.get('x-content-type-options') === 'nosniff');
  const evilCors = await fetch(BASE + '/api/settings/public', { headers: { Origin: 'https://evil.example' } });
  check('security: unknown CORS origin not reflected', !evilCors.headers.has('access-control-allow-origin'));
  const wwwRedirect = await requestWithHost('/', 'www.rogersense.com');
  check('www host redirects to canonical domain', wwwRedirect.status === 301 && /\/\/rogersense\.com\//.test(wwwRedirect.headers.location || ''));

  const robots = await fetch(BASE + '/robots.txt');
  const robotsText = await robots.text();
  check('robots.txt → 200 text', robots.status === 200 && robotsText.includes('User-agent: *'));
  check('robots.txt declares sitemap index', robotsText.includes('Sitemap: https://rogersense.com/sitemap_index.xml'));

  const sitemap = await fetch(BASE + '/sitemap.xml');
  const sitemapText = await sitemap.text();
  check('sitemap.xml → 200 XML urlset', sitemap.status === 200 && sitemapText.includes('<urlset'));
  check('sitemap.xml includes canonical home', sitemapText.includes('<loc>https://rogersense.com/</loc>'));
  check('sitemap.xml includes public static pages', ['/contact', '/track', '/privacy', '/terms'].every(path => sitemapText.includes(`<loc>https://rogersense.com${path}</loc>`)));
  check('sitemap.xml does not expose .html URLs', !sitemapText.includes('.html'));

  const legacyContact = await fetch(BASE + '/contact.html', { redirect: 'manual' });
  check('legacy static .html redirects to clean URL', legacyContact.status === 301 && legacyContact.headers.get('location') === '/contact');
  const legacyShopProductParam = await fetch(BASE + '/shop?p=legacy-product', { redirect: 'manual' });
  check('legacy shop product param redirects to clean product URL', legacyShopProductParam.status === 301 && legacyShopProductParam.headers.get('location') === '/products/legacy-product');
  const legacyCaseCategoryParam = await fetch(BASE + '/cases?category=devboard', { redirect: 'manual' });
  check('legacy case category param redirects to clean category URL', legacyCaseCategoryParam.status === 301 && legacyCaseCategoryParam.headers.get('location') === '/cases/category/devboard');

  const sitemapIndex = await fetch(BASE + '/sitemap_index.xml');
  const sitemapIndexText = await sitemapIndex.text();
  check('sitemap_index.xml → 200 XML index', sitemapIndex.status === 200 && sitemapIndexText.includes('<sitemapindex'));
  check('sitemap_index.xml points to sitemap.xml', sitemapIndexText.includes('<loc>https://rogersense.com/sitemap.xml</loc>'));

  const publicStaticPages = [
    ['/', 'https://rogersense.com/'],
    ['/shop', 'https://rogersense.com/shop'],
    ['/cases', 'https://rogersense.com/cases'],
    ['/blog', 'https://rogersense.com/blog'],
    ['/about', 'https://rogersense.com/about'],
    ['/quote', 'https://rogersense.com/quote'],
    ['/contact', 'https://rogersense.com/contact'],
    ['/track', 'https://rogersense.com/track'],
    ['/privacy', 'https://rogersense.com/privacy'],
    ['/returns', 'https://rogersense.com/returns'],
    ['/shipping', 'https://rogersense.com/shipping'],
    ['/gdpr', 'https://rogersense.com/gdpr'],
    ['/terms', 'https://rogersense.com/terms'],
  ];
  for (const [path, canonical] of publicStaticPages) {
    const page = await fetch(BASE + path);
    const pageText = await page.text();
    check(`static page ${path} has canonical`, page.status === 200 && pageText.includes(`<link rel="canonical" href="${canonical}"/>`));
    check(`static page ${path} has meta description`, /<meta name="description" content="[^"]{20,}"/.test(pageText));
  }

  for (const path of ['/admin', '/login', '/dashboard', '/reset']) {
    const page = await fetch(BASE + path);
    const pageText = await page.text();
    check(`${path} sends X-Robots-Tag noindex`, (page.headers.get('x-robots-tag') || '').includes('noindex'));
    check(`${path} has meta robots noindex`, pageText.includes('<meta name="robots" content="noindex, nofollow, noarchive"/>'));
  }

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
  const newCase = await req('POST', '/api/cases', { token: adminToken, body: {
    title: 'Smart Pet Door', slug: 'smart-pet-door', category: 'iot',
    tags: ['IoT', 'BLE'], description: 'BLE pet door.', cover_image: 'https://static/x.jpg',
    images: ['https://static/1.jpg'], published: true,
  }});
  check('admin creates case → 200', newCase.status === 200 && !!newCase.data?.case?.id);
  const caseId = newCase.data?.case?.id;

  const clientCase = await req('POST', '/api/cases', { token: clientToken, body: { title: 'x', slug: 'x' } });
  check('client cannot create case → 403', clientCase.status === 403);

  const pubCases = await req('GET', '/api/cases');
  check('public sees published case (1)', pubCases.status === 200 && pubCases.data?.cases?.length === 1);
  check('case tags parsed to array', Array.isArray(pubCases.data?.cases?.[0]?.tags));

  const oneCase = await req('GET', '/api/cases/smart-pet-door');
  check('GET case by slug', oneCase.status === 200 && oneCase.data?.case?.slug === 'smart-pet-door');
  const casePage = await fetch(BASE + '/cases/smart-pet-door');
  const casePageText = await casePage.text();
  check('clean case page SSR renders canonical URL', casePage.status === 200 && casePageText.includes('Smart Pet Door') && casePageText.includes('https://rogersense.com/cases/smart-pet-door'));
  const legacyCasePage = await fetch(BASE + '/case-detail.html?slug=smart-pet-door', { redirect: 'manual' });
  check('legacy case parameter URL redirects to clean case URL', legacyCasePage.status === 301 && legacyCasePage.headers.get('location') === '/cases/smart-pet-door');

  await req('PATCH', `/api/cases/${caseId}`, { token: adminToken, body: { published: false } });
  const afterUnpub = await req('GET', '/api/cases');
  check('unpublished hidden from public (0)', afterUnpub.data?.cases?.length === 0);
  const adminCases = await req('GET', '/api/cases', { token: adminToken });
  check('admin still sees draft (1)', adminCases.data?.cases?.length === 1);

  // ── Upload presign ────────────────────────────────────────
  const presign = await req('POST', '/upload/presign', { token: clientToken, body: { filename: 'gerber.zip', contentType: 'application/zip', folder: 'quotes' } });
  check('presign → 200 + url + key', presign.status === 200 && /^https?:\/\//.test(presign.data?.url || '') && /^quotes\//.test(presign.data?.key || ''), `status=${presign.status}`);

  const presignNoAuth = await req('POST', '/upload/presign', { body: { filename: 'a.zip' } });
  check('presign without token → 401', presignNoAuth.status === 401);

  // ── Admin image upload + blog publishing API ──────────────
  const noAuthImage = await uploadAdminImage(null);
  check('admin image upload without token → 401', noAuthImage.status === 401);

  const imgUpload = await uploadAdminImage(adminToken);
  check('admin image upload → 200', imgUpload.status === 200 && imgUpload.data?.ok === true, `status=${imgUpload.status}`);
  check('admin image upload returns WebP key', /^products\/blog\/.+\.webp$/.test(imgUpload.data?.key || ''));
  check('admin image upload returns public /img URL aliases',
    imgUpload.data?.url === imgUpload.data?.imageUrl &&
    imgUpload.data?.url === imgUpload.data?.cover_url &&
    /^\/img\?key=/.test(imgUpload.data?.url || ''));
  check('admin image upload contentType=image/webp', imgUpload.data?.contentType === 'image/webp');

  const postSlug = 'e2e-api-post';
  const postCreate = await req('POST', '/api/admin/posts', { token: adminToken, body: {
    title: 'E2E API Post',
    slug: postSlug,
    contentHtml: '<p>First body from contentHtml.</p>',
    coverUrl: imgUpload.data?.url,
    metaDescription: 'E2E post summary',
    tags: ['api', 'publishing'],
    status: 'published',
    author: 'Rogersense Team',
  }});
  check('admin POST /api/admin/posts creates post', postCreate.status === 200 && postCreate.data?.action === 'created' && !!postCreate.data?.id);
  check('post create returns article URL', postCreate.data?.url === `https://rogersense.com/blog/${postSlug}`);
  const postId = postCreate.data?.id;

  const publicPost = await req('GET', `/api/posts/${postSlug}`);
  check('public GET /api/posts/:slug sees published post', publicPost.status === 200 && publicPost.data?.post?.slug === postSlug);
  check('post saved contentHtml + coverUrl', publicPost.data?.post?.content?.includes('First body') && publicPost.data?.post?.cover_url === imgUpload.data?.url);

  const postUpsert = await req('POST', '/api/admin/posts', { token: adminToken, body: {
    title: 'E2E API Post Updated',
    slug: postSlug,
    content: '<p>Second body from content.</p>',
    imageUrl: imgUpload.data?.url,
    seoDescription: 'Updated E2E summary',
    tags: 'api,updated',
    status: 'published',
  }});
  check('same slug POST updates instead of 409', postUpsert.status === 200 && postUpsert.data?.action === 'updated' && postUpsert.data?.id === postId,
    `status=${postUpsert.status}`);

  const ssrPage = await fetch(`${BASE}/blog/${postSlug}`);
  const ssrText = await ssrPage.text();
  check('SSR blog page renders updated title/body', ssrPage.status === 200 && ssrText.includes('E2E API Post Updated') && ssrText.includes('Second body from content.'));
  check('SSR blog page renders WebP cover URL', ssrText.includes(imgUpload.data?.url || '') && (imgUpload.data?.key || '').endsWith('.webp'));
  const legacyBlogPage = await fetch(`${BASE}/blog-post.html?slug=${postSlug}`, { redirect: 'manual' });
  check('legacy blog parameter URL redirects to clean blog URL', legacyBlogPage.status === 301 && legacyBlogPage.headers.get('location') === `/blog/${postSlug}`);

  const legacyProductPage = await fetch(BASE + '/product.html?slug=e2e-product', { redirect: 'manual' });
  check('legacy product parameter URL redirects to clean product URL', legacyProductPage.status === 301 && legacyProductPage.headers.get('location') === '/products/e2e-product');

  const putUpdate = await req('PUT', `/api/admin/posts/${postId}`, { token: adminToken, body: {
    contentHtml: '<p>Third body from PUT contentHtml.</p>',
    cover_url: imgUpload.data?.url,
    status: 'published',
  }});
  check('PUT /api/admin/posts/:id updates compatible fields', putUpdate.status === 200 && putUpdate.data?.action === 'updated' && putUpdate.data?.slug === postSlug);

  // /img public redirect — serves case/product assets, never private prefixes.
  const imgCase = await fetch(`${BASE}/img?key=cases/x.jpg`, { redirect: 'manual' });
  check('/img cases/ → 302 redirect', imgCase.status === 302);
  const imgProduct = await fetch(`${BASE}/img?key=products/x.jpg`, { redirect: 'manual' });
  check('/img products/ → 302 redirect', imgProduct.status === 302);
  const imgQuote = await fetch(`${BASE}/img?key=quotes/secret.pdf`, { redirect: 'manual' });
  check('/img quotes/ → 403 (private blocked)', imgQuote.status === 403);
  const imgBackup = await fetch(`${BASE}/img?key=backups/d1/latest.json.gz`, { redirect: 'manual' });
  check('/img backups/ → 403 (private blocked)', imgBackup.status === 403);

  // ── Cleanup ───────────────────────────────────────────────
  const del = await req('DELETE', `/api/cases/${caseId}`, { token: adminToken });
  check('admin deletes case → 200', del.status === 200);
  const delPost = await req('DELETE', `/api/admin/posts/${postId}`, { token: adminToken });
  check('admin deletes post → 200', delPost.status === 200);
  const gone = await req('GET', '/api/cases', { token: adminToken });
  check('case removed (0)', gone.data?.cases?.length === 0);
}

(async () => {
  const child = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      SQLITE_PATH: ':memory:',
      PORT: String(PORT),
      SITE_URL: 'https://rogersense.com',
      JWT_SECRET: 'e2e-test-secret',
      DEFAULT_ADMIN_EMAIL: ADMIN_EMAIL,
      DEFAULT_ADMIN_PASSWORD: ADMIN_PASS,
      // Dummy R2 creds so presign can sign locally (no network).
      R2_ACCOUNT_ID: 'dummyacct',
      R2_ACCESS_KEY_ID: 'dummykey',
      R2_SECRET_ACCESS_KEY: 'dummysecret',
      R2_BUCKET: 'rogersense-test',
      R2_UPLOAD_DRY_RUN: '1',
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
