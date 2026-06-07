#!/usr/bin/env node
/**
 * restore.js — restore rogersense D1 tables from an R2 backup.
 *
 *   node restore.js --list
 *   node restore.js --file backups/d1/2026-06-04/backup-....json.gz --dry-run
 *   node restore.js --file backups/d1/2026-06-04/backup-....json.gz --confirm
 *
 * Strategy: INSERT OR REPLACE by primary key. Rows present now but absent
 * from the backup are kept (not deleted). Before a real restore, a
 * pre-restore snapshot of current data is written to R2 so a bad restore
 * is reversible.
 */
require('dotenv').config();
const { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const gzip   = promisify(zlib.gzip);
const fetchFn = global.fetch || require('node-fetch');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DB_ID      = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CF_API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;
const R2_BUCKET     = process.env.R2_BUCKET || 'rogersense-files';
const BACKUP_PREFIX = 'backups/d1';
const TABLES = ['users', 'quotes', 'messages', 'cases'];

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DB_ID}/query`;
async function d1Query(sql, params = []) {
  const res = await fetchFn(D1_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || JSON.stringify(data.errors));
  return data.result?.[0]?.results || [];
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
});
const streamToBuffer = async (stream) => {
  const chunks = []; for await (const c of stream) chunks.push(c); return Buffer.concat(chunks);
};

async function listBackups() {
  const out = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: `${BACKUP_PREFIX}/` }));
  return (out.Contents || []).filter(o => o.Key.endsWith('.json.gz'))
    .sort((a, b) => b.LastModified - a.LastModified);
}
async function fetchBackup(key) {
  const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const buf = await streamToBuffer(obj.Body);
  return JSON.parse((await gunzip(buf)).toString('utf8'));
}

async function snapshotCurrent() {
  const data = {};
  for (const t of TABLES) { try { data[t] = await d1Query(`SELECT * FROM ${t}`); } catch { data[t] = []; } }
  const key = `${BACKUP_PREFIX}/pre-restore/pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json.gz`;
  const gz = await gzip(Buffer.from(JSON.stringify({ meta: { kind: 'pre-restore', created_at: new Date().toISOString() }, data }, null, 2)));
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: gz, ContentType: 'application/gzip' }));
  return key;
}

function buildInsert(table, row) {
  const cols = Object.keys(row);
  const ph = cols.map(() => '?').join(', ');
  const vals = cols.map(c => (row[c] === null || row[c] === undefined) ? null
    : (typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
  return { sql: `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`, vals };
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (has('--list')) {
    const list = await listBackups();
    console.log(`\n📦 Backups in r2://${R2_BUCKET}/${BACKUP_PREFIX}/  (newest first)\n`);
    list.forEach(o => console.log(`  ${o.LastModified.toISOString()}  ${(o.Size/1024).toFixed(1)}KB  ${o.Key}`));
    console.log('');
    return;
  }

  const file = valOf('--file');
  if (!file) { console.error('Usage: node restore.js --list | --file <key> [--dry-run|--confirm]'); process.exit(1); }

  console.log(`\n📥 Loading backup: ${file}`);
  const backup = await fetchBackup(file);
  console.log(`   created_at: ${backup.meta?.created_at}`);
  for (const t of TABLES) {
    const rows = backup.data?.[t];
    console.log(`   ${t}: ${Array.isArray(rows) ? rows.length + ' rows' : 'MISSING/ERROR'}`);
  }

  if (has('--dry-run') || !has('--confirm')) {
    console.log(`\n🔍 Dry run only. Re-run with --confirm to write.\n`);
    return;
  }

  const snap = await snapshotCurrent();
  console.log(`\n🛟 Pre-restore snapshot saved: ${snap}`);
  for (const t of TABLES) {
    const rows = backup.data?.[t];
    if (!Array.isArray(rows)) { console.log(`   ⏭  ${t}: skipped`); continue; }
    let n = 0;
    for (const row of rows) { const { sql, vals } = buildInsert(t, row); await d1Query(sql, vals); n++; }
    console.log(`   ✅ ${t}: ${n} rows restored`);
  }
  console.log(`\n✅ Restore complete. To revert: node restore.js --file ${snap} --confirm\n`);
}
main().catch(err => { console.error('❌ Restore failed:', err.message); process.exit(1); });
