#!/usr/bin/env node
/**
 * backup-d1.js — dump rogersense D1 business tables → JSON → gzip → R2.
 *
 *   node scripts/backup-d1.js
 *
 * Env (shared with the app .env):
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */
require('dotenv').config();
const { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const fetchFn = global.fetch || require('node-fetch');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DB_ID      = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CF_API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;
const R2_BUCKET     = process.env.R2_BUCKET || 'rogersense-files';
const BACKUP_PREFIX = 'backups/d1';
const RETENTION_DAYS = 30;

// settings is excluded — it holds AES-encrypted secrets.
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
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const putR2 = (key, body, ct) => r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: ct }));

async function pruneOld() {
  try {
    const list = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: `${BACKUP_PREFIX}/` }));
    const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
    const stale = (list.Contents || [])
      .filter(o => o.Key.match(/backup-/) && o.LastModified && o.LastModified.getTime() < cutoff)
      .map(o => ({ Key: o.Key }));
    if (stale.length) {
      await r2.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: stale } }));
      console.log(`   🧹 Pruned ${stale.length} backups older than ${RETENTION_DAYS}d`);
    }
  } catch (e) { console.warn('   ⚠️  prune skipped:', e.message); }
}

async function main() {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dateDir   = startedAt.toISOString().slice(0, 10);
  console.log(`\n🗄  rogersense D1 backup — ${startedAt.toISOString()}`);

  const backup = { meta: { created_at: startedAt.toISOString(), db_id: CF_DB_ID, tables: TABLES }, data: {} };
  for (const t of TABLES) {
    try {
      const rows = await d1Query(`SELECT * FROM ${t}`);
      backup.data[t] = rows;
      console.log(`   ✅ ${t}: ${rows.length} rows`);
    } catch (e) {
      console.error(`   ❌ ${t}: ${e.message}`);
      backup.data[t] = { error: e.message };
    }
  }

  const gzipped = await gzip(Buffer.from(JSON.stringify(backup, null, 2), 'utf8'));
  const sizeKB  = (gzipped.length / 1024).toFixed(1);
  const fullKey = `${BACKUP_PREFIX}/${dateDir}/backup-${timestamp}.json.gz`;
  await putR2(fullKey, gzipped, 'application/gzip');
  await putR2(`${BACKUP_PREFIX}/latest.json.gz`, gzipped, 'application/gzip');
  await putR2(`${BACKUP_PREFIX}/manifest.json`, Buffer.from(JSON.stringify({
    last_backup: startedAt.toISOString(), file: fullKey, size_bytes: gzipped.length,
    rows_summary: Object.fromEntries(TABLES.map(t => [t, Array.isArray(backup.data[t]) ? backup.data[t].length : 'error'])),
  }, null, 2), 'utf8'), 'application/json');

  await pruneOld();
  console.log(`\n✅ Backup complete — ${sizeKB} KB → ${fullKey}\n`);
}
main().catch(err => { console.error('❌ Backup failed:', err.message); process.exit(1); });
