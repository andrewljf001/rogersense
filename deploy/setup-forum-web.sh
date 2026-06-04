#!/usr/bin/env bash
# One-time web setup for the Rogersense forum (Flarum). Run with sudo on the VPS:
#   sudo bash /var/www/rogersense/deploy/setup-forum-web.sh
#
# Installs a dedicated PHP-FPM pool + the forum.rogersense.com nginx vhost (HTTP).
# Touches ONLY the forum — existing sites/pools are untouched.
set -euo pipefail

DEPLOY=/var/www/rogersense/deploy

echo "→ Installing dedicated PHP-FPM pool"
cp "$DEPLOY/rogersense-forum-fpm.conf" /etc/php/8.1/fpm/pool.d/rogersense-forum.conf
echo "→ Restarting php8.1-fpm"
systemctl restart php8.1-fpm

echo "→ Installing nginx vhost (forum.rogersense.com)"
cp "$DEPLOY/forum.rogersense.com.nginx" /etc/nginx/sites-available/forum.rogersense.com
ln -sf /etc/nginx/sites-available/forum.rogersense.com /etc/nginx/sites-enabled/forum.rogersense.com

echo "→ Testing nginx config"
nginx -t
echo "→ Reloading nginx"
systemctl reload nginx

echo "✅ FORUM_WEB_DONE — http://forum.rogersense.com should now load."
echo "   Next (after verifying): sudo certbot --nginx -d forum.rogersense.com --redirect -m andrewljf@gmail.com --agree-tos --no-eff-email -n"
