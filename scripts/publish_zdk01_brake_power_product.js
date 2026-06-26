#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const db = require('../database');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || '1'];
  })
);

const dryRun = args.has('dry-run');
const assetsDir = path.resolve(args.get('assets-dir') || 'product-specs');
const R2_BUCKET = process.env.R2_BUCKET || 'rogersense-files';

const files = {
  main: 'rogersense-zdk01-elevator-brake-power-main.jpg',
  terminal: 'rogersense-zdk01-elevator-brake-power-terminal.jpg',
  programming: 'rogersense-zdk01-elevator-brake-power-programming.jpg',
  mounting: 'rogersense-zdk01-elevator-brake-power-mounting.jpg',
  spec: 'rogersense-zdk01-elevator-brake-power-controller-spec.pdf',
};

function requireFile(name) {
  const file = path.join(assetsDir, name);
  if (!fs.existsSync(file)) throw new Error(`Missing upload asset: ${file}`);
  return file;
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function safeName(file) {
  return path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
}

const description = `
<p><strong>ZDK-01 Elevator Brake Power Controller</strong> is an adjustable brake-coil power controller for elevator brake and electromagnetic brake applications. It accepts AC 220 V input and provides a DC 20-220 V adjustable output for excitation and holding control. One online order quantity equals one controller.</p>

<h3>Why engineers choose it</h3>
<ul>
  <li><strong>Adjustable output:</strong> DC 20-220 V output range for matching different brake-coil requirements.</li>
  <li><strong>Two-stage brake control:</strong> set excitation voltage, holding voltage, and the transfer interval between them.</li>
  <li><strong>Clear terminal block:</strong> L / N input and B+ / B- brake-coil output on the controller terminal side.</li>
  <li><strong>Panel-friendly housing:</strong> compact enclosure with mounting ears for cabinet or panel installation.</li>
  <li><strong>Replacement-oriented SKU:</strong> positioned for EMK-BZ127AJ-class elevator brake power replacement use; verify wiring and parameters before installation.</li>
</ul>

<h3>What is included</h3>
<ul>
  <li>1 x ZDK-01 Elevator Brake Power Controller per order quantity.</li>
  <li>English product specification PDF available from the download button on this page.</li>
</ul>

<h3>Typical applications</h3>
<ul>
  <li>Elevator brake power control and service replacement projects.</li>
  <li>Electromagnetic brake-coil excitation and holding control.</li>
  <li>Industrial control cabinets that require adjustable DC brake-coil output from AC 220 V input.</li>
  <li>Maintenance, retrofit, and localized spare-part supply for qualified service teams.</li>
</ul>

<h3>Key specifications</h3>
<table>
  <tr><td>Product name</td><td>Elevator brake power controller</td></tr>
  <tr><td>Model</td><td>ZDK-01</td></tr>
  <tr><td>Sales unit</td><td>1 controller per order quantity</td></tr>
  <tr><td>Input supply</td><td>AC 220 V</td></tr>
  <tr><td>Output voltage</td><td>DC 20-220 V adjustable</td></tr>
  <tr><td>Output current</td><td>10 A reference from supplied product details</td></tr>
  <tr><td>Input terminals</td><td>L, N</td></tr>
  <tr><td>Output terminals</td><td>B+, B- to brake coil</td></tr>
  <tr><td>Parameter modes</td><td>H: excitation voltage; L: holding voltage; S: transfer interval</td></tr>
  <tr><td>Controls</td><td>SET, Up, Down</td></tr>
</table>

<h3>Basic setup sequence</h3>
<ol>
  <li>Disconnect input power before wiring, then connect AC input and a suitable load.</li>
  <li>Press SET once until H flashes, then use Up / Down to set the excitation voltage.</li>
  <li>Press SET again until L flashes, then set the holding voltage.</li>
  <li>Press SET again until S flashes, then set the interval from excitation voltage to holding voltage.</li>
  <li>Press SET again to save the parameters and run one test cycle.</li>
</ol>

<h3>Installation and safety notes</h3>
<ul>
  <li>This controller must be installed, configured, inspected, and serviced only by professionally qualified personnel.</li>
  <li>Do not confuse AC input terminals L / N with DC output terminals B+ / B-. Wiring errors can damage the controller.</li>
  <li>Do not touch terminals while the controller is energized.</li>
  <li>Adjust excitation and holding voltage with a connected load before connecting the final brake coil. The supplied manual suggests a 100 W lamp as a temporary load.</li>
  <li>Elevator brake circuits are safety-critical. Final compliance, inspection, installation approval, and local code requirements remain the responsibility of the installer or system integrator.</li>
</ul>
`.trim();

const product = {
  slug: 'zdk-01-elevator-brake-power-controller',
  name: 'ZDK-01 Elevator Brake Power Controller',
  category: 'tool',
  price: 149,
  currency: 'USD',
  stock: 100,
  summary: '1 controller per order | AC 220 V input | DC 20-220 V adjustable output | 10 A | H/L/S setup',
  description,
  status: 'active',
  sort_order: 8,
};

let uploadCounter = 0;
function createR2Client() {
  requireEnv('R2_ACCOUNT_ID');
  requireEnv('R2_ACCESS_KEY_ID');
  requireEnv('R2_SECRET_ACCESS_KEY');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadPublicProductAsset(r2, file) {
  const key = `products/${Date.now()}_${uploadCounter++}_${safeName(file)}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fs.readFileSync(file),
    ContentType: contentType(file),
  }));
  return `/img?key=${encodeURIComponent(key)}`;
}

async function upsertProduct(payload) {
  const existing = await db.query(`SELECT id FROM products WHERE slug = ?`, [payload.slug]);
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await db.query(
      `UPDATE products
       SET name = ?, category = ?, price = ?, currency = ?, stock = ?, summary = ?,
           description = ?, cover_image = ?, images = ?, downloads = ?, status = ?,
           sort_order = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        payload.name, payload.category, payload.price, payload.currency, payload.stock,
        payload.summary, payload.description, payload.cover_image,
        JSON.stringify(payload.images), JSON.stringify(payload.downloads),
        payload.status, payload.sort_order, id,
      ]
    );
    return { id, action: 'updated' };
  }

  const id = uuidv4();
  await db.query(
    `INSERT INTO products
     (id, slug, name, category, price, currency, stock, summary, description,
      cover_image, images, downloads, status, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, payload.slug, payload.name, payload.category, payload.price, payload.currency,
      payload.stock, payload.summary, payload.description, payload.cover_image,
      JSON.stringify(payload.images), JSON.stringify(payload.downloads),
      payload.status, payload.sort_order,
    ]
  );
  return { id, action: 'created' };
}

async function main() {
  for (const file of Object.values(files)) requireFile(file);

  if (dryRun) {
    const payload = {
      ...product,
      cover_image: `/local/${files.main}`,
      images: [`/local/${files.main}`, `/local/${files.terminal}`, `/local/${files.programming}`, `/local/${files.mounting}`],
      downloads: [{ label: 'ZDK-01 Elevator Brake Power Controller Product Specification (PDF)', url: `/local/${files.spec}` }],
    };
    console.log(JSON.stringify({ ok: true, dryRun: true, product: payload }, null, 2));
    return;
  }

  requireEnv('CLOUDFLARE_ACCOUNT_ID');
  requireEnv('CLOUDFLARE_D1_DATABASE_ID');
  requireEnv('CLOUDFLARE_API_TOKEN');
  const r2 = createR2Client();

  const mainImage = await uploadPublicProductAsset(r2, requireFile(files.main));
  const terminalImage = await uploadPublicProductAsset(r2, requireFile(files.terminal));
  const programmingImage = await uploadPublicProductAsset(r2, requireFile(files.programming));
  const mountingImage = await uploadPublicProductAsset(r2, requireFile(files.mounting));
  const specPdf = await uploadPublicProductAsset(r2, requireFile(files.spec));

  const payload = {
    ...product,
    cover_image: mainImage,
    images: [mainImage, terminalImage, programmingImage, mountingImage],
    downloads: [{ label: 'ZDK-01 Elevator Brake Power Controller Product Specification (PDF)', url: specPdf }],
  };

  const result = await upsertProduct(payload);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    id: result.id,
    slug: payload.slug,
    url: `https://rogersense.com/product.html?slug=${encodeURIComponent(payload.slug)}`,
    assets: {
      images: payload.images,
      downloads: payload.downloads,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
