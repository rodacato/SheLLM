#!/usr/bin/env bash
# setup-vps.sh — One-time VPS provisioning for SheLLM.
# Usage: ssh root@your-vps 'bash -s' < scripts/setup-vps.sh
#
# What this does:
#   1. Creates shellmer user
#   2. Installs Node.js 22, LLM CLIs
#   3. Clones repo, installs deps
#   4. Installs systemd service
#   5. Sets up cloudflared tunnel
#
# After running, you must:
#   - Edit ~shellmer/shellm/.env with your secrets
#   - Authenticate each CLI (sudo -iu shellmer, then claude/gemini/codex auth login)
#   - Start the service (systemctl start shellm)

set -euo pipefail

REPO="git@github.com:rodacato/SheLLM.git"
SHELLM_HOME="/home/shellmer"
APP_DIR="${SHELLM_HOME}/shellm"
DOMAIN="shellm.notdefined.dev"

# --- Must run as root ---
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run this script as root."
  exit 1
fi

echo "==> Creating shellmer user..."
if id shellmer &>/dev/null; then
  echo "  User shellmer already exists — skipping"
else
  useradd -m -s /bin/bash shellmer
  echo "  Created user shellmer"
fi

echo ""
echo "==> Installing Node.js 22..."
if node --version 2>/dev/null | grep -q "^v22"; then
  echo "  Node.js 22 already installed — skipping"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  echo "  Installed Node.js $(node --version)"
fi

echo ""
echo "==> Installing LLM CLIs..."
npm install -g @google/gemini-cli @openai/codex 2>/dev/null
echo "  Installed Gemini CLI and Codex CLI"

echo "  Installing Claude Code as shellmer user..."
sudo -u shellmer bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
echo "  Installed Claude Code"

echo ""
echo "==> Cloning repo..."
if [[ -d "$APP_DIR" ]]; then
  echo "  ${APP_DIR} already exists — pulling latest"
  sudo -u shellmer git -C "$APP_DIR" pull
else
  sudo -u shellmer git clone "$REPO" "$APP_DIR"
  echo "  Cloned to ${APP_DIR}"
fi

echo ""
echo "==> Installing dependencies..."
sudo -u shellmer bash -c "cd ${APP_DIR} && npm ci --omit=dev"

echo ""
echo "==> Setting up shellm CLI..."
sudo -u shellmer mkdir -p "${SHELLM_HOME}/.shellm/logs"
cd "${APP_DIR}" && npm link
echo "  Created ~/.shellm/ dirs and linked shellm CLI"

echo ""
echo "==> Installing logrotate config..."
cp "${APP_DIR}/config/logrotate.conf" /etc/logrotate.d/shellm
echo "  Installed /etc/logrotate.d/shellm"

echo ""
echo "==> Setting up .env..."
if [[ -f "${APP_DIR}/.env" ]]; then
  echo "  .env already exists — skipping"
else
  sudo -u shellmer cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  echo "  Copied .env.example → .env (edit with your secrets)"
fi

echo ""
echo "==> Installing systemd service..."
cp "${APP_DIR}/shellm.service" /etc/systemd/system/shellm.service
systemctl daemon-reload
systemctl enable shellm
echo "  Service installed and enabled (not started yet)"

echo ""
echo "==> Setting up cloudflared..."
if command -v cloudflared &>/dev/null; then
  echo "  cloudflared already installed"
else
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm /tmp/cloudflared.deb
  echo "  Installed cloudflared $(cloudflared --version 2>&1 | head -1)"
fi

echo ""
echo "  To create the tunnel, run:"
echo ""
echo "    cloudflared tunnel login"
echo "    cloudflared tunnel create shellm"
echo "    cloudflared tunnel route dns shellm ${DOMAIN}"
echo ""
echo "  Then create /etc/cloudflared/config.yml:"
echo ""
echo "    tunnel: shellm"
echo "    credentials-file: /root/.cloudflared/<tunnel-id>.json"
echo "    ingress:"
echo "      - hostname: ${DOMAIN}"
echo "        service: http://127.0.0.1:6000"
echo "      - service: http_status:404"
echo ""
echo "  Then install as a service:"
echo ""
echo "    cloudflared service install"
echo "    systemctl start cloudflared"
echo ""

echo "==========================================="
echo "  SheLLM VPS setup complete!"
echo "==========================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit secrets:"
echo "     nano ${APP_DIR}/.env"
echo ""
echo "  2. Authenticate CLIs (as shellmer user):"
echo "     sudo -iu shellmer"
echo "     claude auth login"
echo "     gemini auth login"
echo "     codex auth login"
echo "     exit"
echo ""
echo "  3. Set up cloudflared tunnel (instructions above)"
echo ""
echo "  4. Start the service:"
echo "     systemctl start shellm"
echo ""
echo "  5. Verify:"
echo "     curl http://127.0.0.1:6000/health"
echo "     journalctl -u shellm -f"
echo ""
