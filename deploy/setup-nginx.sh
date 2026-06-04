#!/usr/bin/env bash
# One-time Nginx setup for rogersense.com. Run with sudo on the VPS:
#   sudo bash /var/www/rogersense/deploy/setup-nginx.sh
#
# Installs the vhost, enables it, tests config, reloads Nginx. Touches ONLY
# rogersense.com — existing sites (pcbaforge, diyinai, mrocioa) are untouched.
set -euo pipefail

VHOST_SRC="/var/www/rogersense/deploy/rogersense.com.nginx"
VHOST_DST="/etc/nginx/sites-available/rogersense.com"
ENABLED="/etc/nginx/sites-enabled/rogersense.com"

echo "→ Installing vhost to $VHOST_DST"
cp "$VHOST_SRC" "$VHOST_DST"

echo "→ Enabling site"
ln -sf "$VHOST_DST" "$ENABLED"

echo "→ Testing nginx config"
nginx -t

echo "→ Reloading nginx"
systemctl reload nginx

echo "✅ rogersense.com vhost active (HTTP). Next: point DNS to this VPS, then:"
echo "   sudo certbot --nginx -d rogersense.com -d www.rogersense.com"
