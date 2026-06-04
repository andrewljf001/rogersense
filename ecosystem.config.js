/**
 * PM2 ecosystem config for rogersense.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup        # enable on boot
 *
 * Apps:
 *   - rogersense   main API + static server (server.js)
 *   - backup-d1    nightly D1 → R2 backup (scripts/backup-d1.js)
 */
module.exports = {
  apps: [
    {
      name: 'rogersense',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/app-error.log',
      out_file: 'logs/app-out.log',
      time: true,
    },
    {
      name: 'backup-d1',
      script: 'scripts/backup-d1.js',
      cron_restart: '0 2 * * *',   // daily 02:00 UTC
      autorestart: false,
      watch: false,
      error_file: 'logs/backup-error.log',
      out_file: 'logs/backup-out.log',
      time: true,
    },
  ],
};
