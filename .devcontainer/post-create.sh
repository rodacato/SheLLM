#!/usr/bin/env bash
# Re-runs on every rebuild: everything here must be idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

# Named volumes are created root-owned; the CLIs and npm write into them as the remote user.
sudo chown "$(id -u):$(id -g)" node_modules "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex"

npm install

# The versions production is tested against live in VERSIONS.md; claude comes from its feature.
command -v gemini >/dev/null 2>&1 || npm install -g @google/gemini-cli
command -v codex >/dev/null 2>&1 || npm install -g @openai/codex

[ -f .env ] || cp .env.example .env

echo ""
echo "  shellm ready — npm run dev serves :6100, npm test runs the suite."
echo "  Provider logins survive rebuilds: claude, gemini and codex need one login each, once."
