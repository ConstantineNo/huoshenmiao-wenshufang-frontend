#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_ROOT/deploy/runtime/cloud-print-web.env"
ENV_EXAMPLE="$APP_ROOT/deploy/runtime/cloud-print-web.env.example"
NGINX_TEMPLATE="$APP_ROOT/deploy/nginx/cloud-print-web.conf"
DIST_DIR="$APP_ROOT/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "dist directory is required; CI should upload built frontend assets before deploy"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE is required"
  echo "create it from $ENV_EXAMPLE before running deploy"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "${FRONTEND_DEPLOY_DIR:-}" ]; then
  echo "FRONTEND_DEPLOY_DIR is required"
  exit 1
fi

if [ -z "${FRONTEND_DOMAIN:-}" ]; then
  echo "FRONTEND_DOMAIN is required"
  exit 1
fi

if [ -z "${CERTBOT_EMAIL:-}" ]; then
  echo "CERTBOT_EMAIL is required"
  exit 1
fi

FRONTEND_CLIENT_MAX_BODY_SIZE="${FRONTEND_CLIENT_MAX_BODY_SIZE:-100m}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-cloud-print-web.conf}"
NGINX_SITE_AVAILABLE_DIR="${NGINX_SITE_AVAILABLE_DIR:-/etc/nginx/sites-available}"
NGINX_SITE_ENABLED_DIR="${NGINX_SITE_ENABLED_DIR:-/etc/nginx/sites-enabled}"
NGINX_SITE_PATH="$NGINX_SITE_AVAILABLE_DIR/$NGINX_SITE_NAME"
NGINX_LINK_PATH="$NGINX_SITE_ENABLED_DIR/$NGINX_SITE_NAME"
LE_LIVE_DIR="/etc/letsencrypt/live/$FRONTEND_DOMAIN"

sudo mkdir -p "$FRONTEND_DEPLOY_DIR"
sudo rsync -av --delete "$DIST_DIR/" "$FRONTEND_DEPLOY_DIR/"
sudo mkdir -p "$FRONTEND_DEPLOY_DIR/.well-known/acme-challenge"

render_https_conf() {
  sed \
    -e "s|print.1to.top|$FRONTEND_DOMAIN|g" \
    -e "s|100m|$FRONTEND_CLIENT_MAX_BODY_SIZE|g" \
    -e "s|__FRONTEND_DEPLOY_DIR__|$FRONTEND_DEPLOY_DIR|g" \
    "$NGINX_TEMPLATE"
}

render_http_bootstrap_conf() {
  cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $FRONTEND_DOMAIN;
    client_max_body_size $FRONTEND_CLIENT_MAX_BODY_SIZE;

    root $FRONTEND_DEPLOY_DIR;
    index index.html;

    location /.well-known/acme-challenge/ {
        root $FRONTEND_DEPLOY_DIR;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
}

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is required"
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot is required"
  exit 1
fi

sudo mkdir -p "$NGINX_SITE_AVAILABLE_DIR" "$NGINX_SITE_ENABLED_DIR"

if [ ! -f "$LE_LIVE_DIR/fullchain.pem" ] || [ ! -f "$LE_LIVE_DIR/privkey.pem" ]; then
  render_http_bootstrap_conf | sudo tee "$NGINX_SITE_PATH" >/dev/null
  sudo ln -sfn "$NGINX_SITE_PATH" "$NGINX_LINK_PATH"
  sudo nginx -t
  sudo systemctl reload nginx

  sudo certbot certonly \
    --webroot \
    -w "$FRONTEND_DEPLOY_DIR" \
    -d "$FRONTEND_DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m "$CERTBOT_EMAIL"
fi

render_https_conf | sudo tee "$NGINX_SITE_PATH" >/dev/null
sudo ln -sfn "$NGINX_SITE_PATH" "$NGINX_LINK_PATH"
sudo nginx -t
sudo systemctl reload nginx
