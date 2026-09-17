#!/usr/bin/env bash
# Re-runs on every rebuild: everything here must be idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

# Named volumes are created root-owned; the CLIs and npm write into them as the remote user.
sudo chown "$(id -u):$(id -g)" node_modules "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex"

# virtiofs intermittently reports the bind mount as foreign-owned; system scope because dotfiles rewrite ~/.gitconfig.
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$PWD" || sudo git config --system --add safe.directory "$PWD"

npm install
# The node_modules volume outlives Node upgrades; a native module built for another ABI fails to load.
node -e "require('better-sqlite3')" 2>/dev/null || npm rebuild better-sqlite3

# The versions production is tested against live in VERSIONS.md; claude comes from its feature.
command -v gemini >/dev/null 2>&1 || npm install -g @google/gemini-cli
command -v codex >/dev/null 2>&1 || npm install -g @openai/codex

config="${XDG_CONFIG_HOME:-$HOME/.config}/shellm/env"
[ -f "$config" ] || install -D -m 600 .env.example "$config"

echo ""
echo "  shellm ready — npm run dev serves :6100, npm test runs the suite."
echo "  Provider logins survive rebuilds: claude, gemini and codex need one login each, once."
