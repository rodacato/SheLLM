#!/usr/bin/env bash
# deploy.sh — Deploy SheLLM updates to VPS.
# Usage: bash scripts/deploy.sh user@host
#
# Pulls latest code, installs deps if needed, restarts service, verifies health.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/deploy.sh user@host"
  echo "Example: bash scripts/deploy.sh root@my-vps.example.com"
  exit 1
fi

HOST="$1"
APP_DIR="/home/shellm/shellm"

echo "==> Deploying SheLLM to ${HOST}..."

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail

echo "  Pulling latest code..."
sudo -u shellm git -C ${APP_DIR} pull

echo "  Checking if dependencies need updating..."
cd ${APP_DIR}
if sudo -u shellm git diff HEAD~1 --name-only | grep -q "package-lock.json"; then
  echo "  package-lock.json changed — running npm ci..."
  sudo -u shellm bash -c "cd ${APP_DIR} && npm ci --omit=dev"
else
  echo "  No dependency changes — skipping npm ci"
fi

echo "  Restarting service..."
systemctl restart shellm

echo "  Waiting for startup..."
sleep 3

echo "  Health check..."
if curl -sf http://127.0.0.1:6000/health | python3 -m json.tool 2>/dev/null; then
  echo ""
  echo "  Deploy successful!"
else
  echo "  WARNING: Health check failed. Check logs:"
  echo "  journalctl -u shellm -n 20 --no-pager"
  exit 1
fi
REMOTE

echo ""
echo "==> Done."
