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

const assetsDir = path.resolve(args.get('assets-dir') || '/tmp/rogersense-ble-relay-case-post');
const coverFile = path.join(assetsDir, 'bluetooth-relay-production-control-cover.jpg');
const flowFile = path.join(assetsDir, 'bluetooth-relay-production-control-flow.jpg');

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

function buildContent(flowUrl) {
  return `
<p>In many production environments, a machine does not need to run continuously. It only needs to be enabled when an authorized operator is physically present at the workstation. The Rogersense Bluetooth Proximity Relay Module can turn that presence into a simple dry-contact control signal.</p>

<p>When an approved operator approaches the equipment with a paired phone, the relay activates and enables the machine. When the operator leaves the configured sensing range, the relay releases automatically and the equipment returns to a disabled or standby state.</p>

<h2>The production scenario</h2>
<p>Consider a small production fixture, test bench, calibration station, or auxiliary machine on a workshop floor. The equipment should be available to trained staff, but it should not remain enabled when nobody is nearby.</p>

<p>The Bluetooth Proximity Relay Module is installed in the control path of the equipment. Its relay output can be wired to a PLC input, controller enable input, low-voltage relay interface, or other dry-contact control circuit. Authorized phones are paired in advance, and the sensing distance is configured during setup.</p>

<img src="${flowUrl}" alt="Production equipment proximity control flow"/>

<h2>How the control works</h2>
<ol>
  <li>The authorized operator approaches the machine with a paired phone.</li>
  <li>The module detects the phone inside the configured Bluetooth proximity range.</li>
  <li>The relay output changes state through NO / COM or NC / COM.</li>
  <li>The equipment enable circuit turns on and the machine becomes available for operation.</li>
  <li>When the operator leaves the area, the relay releases automatically.</li>
  <li>The machine is disabled or returned to standby.</li>
</ol>

<h2>Why this is useful on the production floor</h2>
<ul>
  <li><strong>Hands-free enable control:</strong> operators do not need to press a separate switch before every task.</li>
  <li><strong>Presence-based shutdown:</strong> equipment can be disabled when the authorized person leaves the workstation.</li>
  <li><strong>Flexible wiring:</strong> NO / NC / COM dry-contact output works with many controller and relay-input designs.</li>
  <li><strong>Configurable behavior:</strong> sensing distance, lock/unlock thresholds, relay timing, and latching or pulse behavior can be adjusted.</li>
  <li><strong>Multi-user operation:</strong> up to 50 phones can be paired for shared team access.</li>
</ul>

<h2>Secondary development interface</h2>
<p>For OEMs, machine builders, and production-line integrators, Rogersense can provide secondary development support. This can include custom relay timing, Bluetooth behavior tuning, pairing workflow adaptation, logic changes, and interface adaptation for PLCs, controllers, fixtures, or customer-specific equipment.</p>

<p>If the standard module behavior does not fully match the production process, Rogersense can help define a custom control flow and provide the firmware or integration interface needed for the final system.</p>

<blockquote>This module is best used as an equipment-enable or auxiliary control component. It should not replace certified emergency-stop circuits, machine-safety interlocks, guarding systems, or other required safety controls.</blockquote>

<h2>Where it fits</h2>
<p>This control pattern is suitable for production fixtures, test benches, auxiliary tools, access-controlled workstations, lab equipment, and other systems that benefit from simple proximity-based enable control.</p>

<p>For module details, see the <a href="//products/bluetooth-proximity-relay-module">Bluetooth Proximity Relay Module product page</a>, or <a href="/contact">contact Rogersense</a> for a custom integration discussion.</p>
`.trim();
}

const post = {
  slug: 'production-equipment-proximity-control-bluetooth-relay',
  title: 'Production Equipment Proximity Control with a Bluetooth Relay Module',
  excerpt: 'An application case for enabling production equipment when an authorized operator is nearby, and automatically disabling it when they leave the workstation.',
  tags: ['Application Case', 'Bluetooth Relay', 'Production Control', 'Automation'],
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
  requireFile(flowFile);

  const coverUrl = await uploadImage(coverFile);
  const flowUrl = await uploadImage(flowFile);

  const payload = {
    ...post,
    cover_url: coverUrl,
    content: buildContent(flowUrl),
  };

  const result = await upsertPost(payload);
  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    id: result.id,
    slug: payload.slug,
    url: `https://rogersense.com/blog/${encodeURIComponent(payload.slug)}`,
    coverUrl,
    flowUrl,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
