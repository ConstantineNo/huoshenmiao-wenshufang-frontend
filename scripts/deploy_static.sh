#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_ROOT/deploy/runtime/cloud-print-web.env"
ENV_EXAMPLE="$APP_ROOT/deploy/runtime/cloud-print-web.env.example"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "created $ENV_FILE from example; review values before publishing"
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "${FRONTEND_DEPLOY_DIR:-}" ]; then
  echo "FRONTEND_DEPLOY_DIR is required"
  exit 1
fi

npm install
npm run build

mkdir -p "$FRONTEND_DEPLOY_DIR"
rsync -av --delete "$APP_ROOT/dist/" "$FRONTEND_DEPLOY_DIR/"
