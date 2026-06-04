#!/usr/bin/env node
/**
 * backup-forum.js — dump the Flarum MySQL database, gzip, upload to R2.
 * Keeps 30 days. Run from /var/www/rogersense (shares its .env + node_modules).
 *
 *   node scripts/backup-forum.js
 *
 * Env (in /var/www/rogersense/.env):
 *   FORUM_DB_NAME, FORUM_DB_USER, FORUM_DB_PASSWORD
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */
require('dotenv').config();
const { execSync } = require('node:child_process');
const zlib = require('node:zlib');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const DB   = process.env.FORUM_DB_NAME || 'rogersense_forum';
const USER = process.env.FORUM_DB_USER || 'rogersense_forum';
const PASS = process.env.FORUM_DB_PASSWORD || '';
const BUCKET = process.env.R2_BUCKET || 'rogersense-files';
const PREFIX = 'backups/forum';
const RETENTION_DAYS = 30;

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
});

async function main() {
  const started = new Date();
  const ts = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const date = started.toISOString().slice(0, 10);

  // mysqldump (password via MYSQL_PWD, not argv)
  const sql = execSync(
    `mysqldump -u ${USER} --single-transaction --quick --default-character-set=utf8mb4 ${DB}`,
    { env: { ...process.env, MYSQL_PWD: PASS }, maxBuffer: 1 << 28 }
  );
  const gz = zlib.gzipSync(sql);
  const sizeKB = (gz.length / 1024).toFixed(1);

  const key = `${PREFIX}/${date}/forum-${ts}.sql.gz`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: gz, ContentType: 'application/gzip' }));
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}/latest.sql.gz`, Body: gz, ContentType: 'application/gzip' }));

  // prune > RETENTION_DAYS
  try {
    const list = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/` }));
    const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
    const stale = (list.Contents || [])
      .filter(o => /forum-/.test(o.Key) && o.LastModified && o.LastModified.getTime() < cutoff)
      .map(o => ({ Key: o.Key }));
    if (stale.length) await r2.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: stale } }));
  } catch (e) { console.warn('prune skipped:', e.message); }

  console.log(`✅ Forum backup complete — ${sizeKB} KB → ${key}`);
}
main().catch(err => { console.error('❌ Forum backup failed:', err.message); process.exit(1); });
