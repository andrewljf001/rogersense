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

const assetsDir = path.resolve(args.get('assets-dir') || '/tmp/rogersense-bluetooth-relay-upload');

const files = {
  main: 'rogersense-bluetooth-relay-main-5pcs.png',
  photo: 'rogersense-bluetooth-relay-product-photo.jpg',
  frontBack: 'rogersense-bluetooth-relay-front-back.jpg',
  package: 'rogersense-bluetooth-relay-package.jpg',
  spec: 'rogersense-bluetooth-proximity-relay-module-spec.pdf',
};

function requireFile(name) {
  const file = path.join(assetsDir, name);
  if (!fs.existsSync(file)) throw new Error(`Missing upload asset: ${file}`);
  return file;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function safeName(file) {
  return path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
}

let uploadCounter = 0;
async function uploadPublicProductAsset(file) {
  const key = `products/${Date.now()}_${uploadCounter++}_${safeName(file)}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fs.readFileSync(file),
    ContentType: contentType(file),
  }));
  return `/img?key=${encodeURIComponent(key)}`;
}

const description = `
<p><strong>Bluetooth Proximity Relay Module - 5PCS Set</strong> is a compact phone-proximity relay module for prototypes, access-control experiments, device enable/disable triggers, and low-voltage automation projects. One online order quantity equals one set of five modules.</p>

<h3>Why engineers choose it</h3>
<ul>
  <li><strong>Proximity trigger:</strong> approach with a paired phone to enable the relay, leave the sensing range to release it.</li>
  <li><strong>No native app install:</strong> setup is handled through a WeChat mini-program on iOS or Android.</li>
  <li><strong>Flexible relay output:</strong> NO / NC / COM dry-contact terminals support normally-open and normally-closed wiring.</li>
  <li><strong>Configurable behavior:</strong> device name, password, sensing distance, unlock threshold, lock threshold, and pulse/latching mode can be adjusted.</li>
  <li><strong>Multi-user pairing:</strong> up to 50 phones can be paired with one module for shared access or team demos.</li>
</ul>

<h3>Typical applications</h3>
<ul>
  <li>Bluetooth proximity enable/disable for small devices and demo rigs.</li>
  <li>Dry-contact trigger for controller inputs, low-voltage locks, relays, or signal interfaces.</li>
  <li>Prototype access-control logic for doors, cabinets, scooters, carts, and lab fixtures.</li>
  <li>Education, makerspace, and engineering validation projects that need configurable phone-based presence detection.</li>
</ul>

<h3>What is included</h3>
<ul>
  <li>5 x Bluetooth proximity relay modules per set.</li>
  <li>Product specification PDF available from the download button on this page.</li>
</ul>

<h3>Key specifications</h3>
<table>
  <tr><td>Supply voltage</td><td>5-12V DC input, nominal 12V DC</td></tr>
  <tr><td>Standby current</td><td>Approx. 10 mA</td></tr>
  <tr><td>Operating power</td><td>Less than or equal to 0.5 W</td></tr>
  <tr><td>Relay output</td><td>SPDT dry contact: NO, COM, NC</td></tr>
  <tr><td>Relay contact rating</td><td>10A / 250VAC reference rating; design final load margins carefully</td></tr>
  <tr><td>Module size</td><td>62 x 20 x 17 mm</td></tr>
  <tr><td>Bluetooth name</td><td>Starts with NBH-</td></tr>
  <tr><td>Default pairing password</td><td>123456, configurable after setup</td></tr>
  <tr><td>Paired phones</td><td>Up to 50 phones</td></tr>
</table>

<h3>Integration and compliance notes</h3>
<ul>
  <li>This module is supplied as an integration component. Final device certification, enclosure design, labeling, and market compliance remain the responsibility of the system integrator or seller of the finished product.</li>
  <li>Do not use the module as the sole safety interlock, life-safety device, or emergency stop mechanism.</li>
  <li>For mains-voltage or high-current loads, use qualified wiring practices, insulation, fusing, spacing, and load derating. Installation should be performed by qualified personnel.</li>
  <li>Bluetooth radio products and final host devices may require market-specific approvals such as FCC, CE RED, UKCA, ISED, MIC, SRRC, KC, or other national RF rules.</li>
</ul>
`.trim();

const product = {
  slug: 'bluetooth-proximity-relay-module',
  name: 'Bluetooth Proximity Relay Module - 5PCS Set',
  category: 'board',
  price: 99,
  currency: 'USD',
  stock: 100,
  summary: '5 modules per set | 5-12V DC | 10A relay | NO/NC/COM dry-contact output | phone proximity trigger',
  description,
  status: 'active',
  sort_order: 10,
};

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

  const mainImage = await uploadPublicProductAsset(requireFile(files.main));
  const photoImage = await uploadPublicProductAsset(requireFile(files.photo));
  const frontBackImage = await uploadPublicProductAsset(requireFile(files.frontBack));
  const packageImage = await uploadPublicProductAsset(requireFile(files.package));
  const specPdf = await uploadPublicProductAsset(requireFile(files.spec));

  const payload = {
    ...product,
    cover_image: mainImage,
    images: [mainImage, photoImage, frontBackImage, packageImage],
    downloads: [{ label: 'Bluetooth Proximity Relay Module Product Specification (PDF)', url: specPdf }],
  };

  const result = await upsertProduct(payload);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    id: result.id,
    slug: payload.slug,
    url: `https://rogersense.com/products/${encodeURIComponent(payload.slug)}`,
    assets: {
      images: payload.images,
      downloads: payload.downloads,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
