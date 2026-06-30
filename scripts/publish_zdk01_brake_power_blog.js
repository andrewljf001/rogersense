#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const db = require('../database');

const R2_BUCKET = process.env.R2_BUCKET || 'rogersense-files';
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || '1'];
  })
);

const assetsDir = path.resolve(args.get('assets-dir') || 'blog-assets');
const coverFile = path.join(assetsDir, 'zdk01-adjustable-elevator-brake-power-cover.jpg');
const productUrl = '//products/zdk-01-elevator-brake-power-controller';
const specUrl = '/img?key=products%2F1780804839295_4_rogersense-zdk01-elevator-brake-power-controller-spec.pdf';

function requireFile(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing asset: ${file}`);
}

function safeName(file) {
  return path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
}

let uploadCounter = 0;
async function uploadImage(file) {
  const key = `products/${Date.now()}_${uploadCounter++}_${safeName(file)}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fs.readFileSync(file),
    ContentType: 'image/jpeg',
  }));
  return `/img?key=${encodeURIComponent(key)}`;
}

function productCard() {
  return `
<a href="${productUrl}" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 16px 36px rgba(13,148,136,.18)';this.querySelector('[data-rs-button]').style.background='#0f766e';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 12px 30px rgba(15,23,42,.10)';this.querySelector('[data-rs-button]').style.background='#0d9488';" style="display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);gap:18px;align-items:stretch;border:1px solid #d8e6e2;border-radius:12px;overflow:hidden;margin:20px 0;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.10);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s;">
  <span style="display:flex;align-items:center;justify-content:center;background:#eef7f5;min-height:150px;padding:10px;">
    <img src="/img?key=products%2F1780804835783_0_rogersense-zdk01-elevator-brake-power-main.jpg" alt="ZDK-01 Elevator Brake Power Controller" style="display:block;width:100%;height:100%;max-height:160px;object-fit:cover;border-radius:8px;"/>
  </span>
  <span style="display:block;padding:18px 18px 18px 0;">
    <span style="display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#dff7f1;color:#0f766e;font-size:.74rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">Elevator brake power</span>
    <strong style="display:block;font-size:1.12rem;line-height:1.35;color:#111827;margin-bottom:7px;">ZDK-01 Elevator Brake Power Controller</strong>
    <span style="display:block;color:#475569;line-height:1.65;margin-bottom:12px;">1 controller per order. AC 220 V input, DC 20-220 V adjustable output, 10 A output reference, and H/L/S parameter setup for excitation, holding, and timing.</span>
    <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;background:#0d9488;color:#fff;font-weight:800;transition:background .16s;">View product &rarr;</span>
  </span>
</a>`.trim();
}

function supportCard() {
  return `
<a href="/contact" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 14px 30px rgba(13,148,136,.14)';this.querySelector('[data-rs-button]').style.background='#0d9488';this.querySelector('[data-rs-button]').style.color='#fff';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 8px 22px rgba(15,23,42,.07)';this.querySelector('[data-rs-button]').style.background='#fff';this.querySelector('[data-rs-button]').style.color='#0f766e';" style="display:block;border:1px solid #d8e6e2;border-radius:12px;padding:18px 20px;margin:18px 0;background:#f8fafc;box-shadow:0 8px 22px rgba(15,23,42,.07);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s;">
  <span style="display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#e0f2fe;color:#0369a1;font-size:.74rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">Secondary development</span>
  <strong style="display:block;font-size:1.08rem;line-height:1.35;color:#111827;margin-bottom:7px;">Need a customer-specific brake power control version?</strong>
  <span style="display:block;color:#475569;line-height:1.65;margin-bottom:12px;">Rogersense can discuss parameter defaults, control timing, interface adaptation, documentation, labeling, and OEM localization requirements for your project.</span>
  <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;border:1px solid #0d9488;color:#0f766e;font-weight:800;background:#fff;transition:background .16s,color .16s;">Talk with engineering &rarr;</span>
</a>`.trim();
}

function buildContent() {
  return `
<p>Elevator brake power control is a practical detail that can decide whether a maintenance replacement feels straightforward or difficult. Many brake coils do not behave exactly the same in the field: coil voltage, holding behavior, cabinet wiring, and site conditions can vary from one elevator system to another.</p>

<p>That is why an adjustable brake power controller matters. Instead of treating the brake coil as a fixed-output load, the <a href="${productUrl}">ZDK-01 Elevator Brake Power Controller</a> gives service teams and integrators a way to tune output voltage and timing for the actual application.</p>

<h2>The advantage: adjustable voltage</h2>
<p>The ZDK-01 supports AC 220 V input and DC 20-220 V adjustable output. This wide adjustable range is the key difference from fixed-output brake power modules. When a project involves different brake coil requirements, a single adjustable platform can be easier to stock, test, and adapt.</p>

<p>In practical terms, the controller supports two important voltage stages:</p>
<ul>
  <li><strong>Excitation voltage:</strong> a stronger output stage used to energize or release the brake coil.</li>
  <li><strong>Holding voltage:</strong> a lower sustained output stage used after the brake has already moved into the required state.</li>
</ul>

<p>By separating excitation and holding behavior, the controller can support more flexible brake-coil tuning than a simple fixed-voltage supply. The exact settings must still be verified by qualified elevator or industrial-control personnel at the installation site.</p>

<h2>Built for different elevator scenarios</h2>
<p>Elevator maintenance and retrofit work often involves mixed equipment. A replacement part may need to fit a cabinet with limited space, a brake coil with specific voltage behavior, or a service process that requires repeatable setup.</p>

<p>The ZDK-01 is designed for these kinds of scenarios:</p>
<ul>
  <li>Elevator brake power service replacement and localization projects.</li>
  <li>Electromagnetic brake-coil excitation and holding control.</li>
  <li>Industrial control cabinets where AC 220 V input needs adjustable DC brake output.</li>
  <li>Maintenance teams that want one adjustable spare-part option for multiple brake-coil conditions.</li>
</ul>

<h2>H / L / S parameter setup</h2>
<p>The front panel uses SET, Up, and Down keys. The setup flow is intentionally simple: set the H value for excitation voltage, set the L value for holding voltage, then set the S value for the transfer interval from excitation to holding output.</p>

<p>This makes the module easier to configure during service work, while still giving engineers enough control to tune the output behavior. The supplied setup guidance also emphasizes adjusting with a connected load before connecting the final brake coil.</p>

<h2>Secondary development for customer-specific needs</h2>
<p>For OEMs, elevator service companies, distributors, and integrators, the standard ZDK-01 product can be a starting point rather than the end of the conversation. Rogersense can discuss secondary development and adaptation based on customer requirements.</p>

<p>Possible secondary-development directions include:</p>
<ul>
  <li><strong>Parameter customization:</strong> default H / L / S values, setup range, and field-service workflow.</li>
  <li><strong>Control logic adaptation:</strong> timing behavior, startup behavior, recovery behavior, or customer-specific operating sequence.</li>
  <li><strong>Interface and wiring support:</strong> terminal labeling, cabinet wiring documentation, and integration notes for the target elevator control system.</li>
  <li><strong>OEM localization:</strong> English documentation, private-label packaging, product page content, and market-specific user instructions.</li>
  <li><strong>Project support:</strong> reviewing the customer's brake-coil requirements and helping define a safer, clearer replacement plan.</li>
</ul>

${supportCard()}

<h2>Product resources</h2>
<p>The online product page includes four English product images and a downloadable English specification PDF. The product is sold individually: one online order quantity equals one ZDK-01 controller.</p>

${productCard()}

<p><a href="${specUrl}" target="_blank" rel="noopener">Download the ZDK-01 product specification PDF</a> for electrical data, terminal definitions, H/L/S setup steps, and integration notes.</p>

<blockquote>Important: elevator brake circuits are safety-critical. Product selection, wiring, parameter setup, inspection, and approval must be handled by qualified personnel according to local elevator, electrical, and workplace-safety requirements.</blockquote>
`.trim();
}

const post = {
  slug: 'adjustable-voltage-elevator-brake-power-controller-zdk01',
  title: 'Why Adjustable Voltage Matters in Elevator Brake Power Control',
  excerpt: 'The ZDK-01 brake power controller provides AC 220 V input, DC 20-220 V adjustable output, H/L/S parameter setup, and secondary-development support for customer-specific elevator scenarios.',
  tags: ['Elevator Brake Power', 'ZDK-01', 'Industrial Control', 'Secondary Development'],
  status: 'published',
  author: 'Rogersense Team',
};

async function upsertPost(payload) {
  const existing = await db.query(`SELECT id, published_at FROM posts WHERE slug = ?`, [payload.slug]);
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    const publishedAt = existing.rows[0].published_at || new Date().toISOString();
    await db.query(
      `UPDATE posts
       SET title = ?, excerpt = ?, content = ?, cover_url = ?, tags = ?,
           status = ?, author = ?, published_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        payload.title, payload.excerpt, payload.content, payload.cover_url,
        JSON.stringify(payload.tags), payload.status, payload.author, publishedAt, id,
      ]
    );
    return { id, action: 'updated' };
  }

  const id = uuidv4();
  await db.query(
    `INSERT INTO posts (id, slug, title, excerpt, content, cover_url, tags, status, author, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, payload.slug, payload.title, payload.excerpt, payload.content,
      payload.cover_url, JSON.stringify(payload.tags), payload.status, payload.author,
      new Date().toISOString(),
    ]
  );
  return { id, action: 'created' };
}

async function main() {
  requireFile(coverFile);
  const coverUrl = await uploadImage(coverFile);
  const payload = {
    ...post,
    cover_url: coverUrl,
    content: buildContent(),
  };

  const result = await upsertPost(payload);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    id: result.id,
    slug: payload.slug,
    url: `https://rogersense.com/blog/${encodeURIComponent(payload.slug)}`,
    coverUrl,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
