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

const assetsDir = path.resolve(args.get('assets-dir') || '/tmp/rogersense-ble-relay-case');

const files = {
  cover: 'bluetooth-relay-production-control-cover.jpg',
  flow: 'bluetooth-relay-production-control-flow.jpg',
  product: 'rogersense-bluetooth-relay-product-photo.jpg',
  frontBack: 'rogersense-bluetooth-relay-front-back.jpg',
};

function requireFile(name) {
  const file = path.join(assetsDir, name);
  if (!fs.existsSync(file)) throw new Error(`Missing asset: ${file}`);
  return file;
}

function safeName(file) {
  return path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
}

let uploadCounter = 0;
async function uploadImage(file) {
  const key = `cases/${Date.now()}_${uploadCounter++}_${safeName(file)}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fs.readFileSync(file),
    ContentType: 'image/jpeg',
  }));
  return `/img?key=${encodeURIComponent(key)}`;
}

const description = `A production operator steps up to a workstation with an authorized phone in their pocket. The fixture should be enabled only while that trained person is nearby; when they leave the area, the equipment should return to standby automatically instead of depending on a forgotten switch.</p><p><strong>Our approach</strong><br>We integrated the Rogersense Bluetooth Proximity Relay Module as a dry-contact enable stage for the production equipment. Authorized phones are paired in advance. When a paired phone enters the configured sensing range, the relay changes state through NO / COM or NC / COM and enables the machine controller, PLC input, low-voltage relay interface, or fixture enable circuit. When the operator leaves the range, the relay releases and the equipment is disabled automatically.</p><p><strong>Secondary development interface</strong><br>For machine builders, OEMs, and production-line integrators, Rogersense can provide secondary development interfaces and custom integration support. This can include relay timing, pulse or latching behavior, Bluetooth threshold tuning, pairing workflow adaptation, PLC/controller signal mapping, and customer-specific firmware logic.</p><p><strong>The result</strong><br>• Hands-free machine enable control for authorized operators<br>• Automatic equipment disable when the operator leaves the workstation<br>• Simple NO / NC / COM dry-contact integration<br>• Configurable sensing distance and relay behavior<br>• A practical base module for OEM production-control customization</p><p><strong>Safety boundary</strong><br>This module is intended for equipment-enable and auxiliary control use. It should not replace emergency-stop circuits, certified safety interlocks, machine guarding, or other required safety-control systems.`;

const caseData = {
  slug: 'production-equipment-proximity-control',
  title: 'Production Equipment Proximity Control',
  category: 'industrial',
  tags: ['Industrial', 'Bluetooth Relay', 'Equipment Control', 'Automation', 'OEM Integration'],
  description,
  published: true,
};

async function upsertCase(payload) {
  const existing = await db.query(`SELECT id FROM cases WHERE slug = ?`, [payload.slug]);
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await db.query(
      `UPDATE cases
       SET title = ?, category = ?, tags = ?, description = ?, cover_image = ?,
           images = ?, published = 1, updated_at = datetime('now')
       WHERE id = ?`,
      [
        payload.title, payload.category, JSON.stringify(payload.tags), payload.description,
        payload.cover_image, JSON.stringify(payload.images), id,
      ]
    );
    return { id, action: 'updated' };
  }

  const id = uuidv4();
  await db.query(
    `INSERT INTO cases (id, slug, title, category, tags, description, cover_image, images, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, payload.slug, payload.title, payload.category, JSON.stringify(payload.tags),
      payload.description, payload.cover_image, JSON.stringify(payload.images),
    ]
  );
  return { id, action: 'created' };
}

async function main() {
  for (const file of Object.values(files)) requireFile(file);

  const cover = await uploadImage(requireFile(files.cover));
  const flow = await uploadImage(requireFile(files.flow));
  const product = await uploadImage(requireFile(files.product));
  const frontBack = await uploadImage(requireFile(files.frontBack));

  const payload = {
    ...caseData,
    cover_image: cover,
    images: [flow, product, frontBack],
  };

  const result = await upsertCase(payload);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    id: result.id,
    slug: payload.slug,
    url: `https://rogersense.com/cases/${encodeURIComponent(payload.slug)}`,
    cover,
    images: payload.images,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
