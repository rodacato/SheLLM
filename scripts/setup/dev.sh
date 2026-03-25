#!/usr/bin/env bash
# setup/dev.sh — interactive dev environment setup for SheLLM
# Run once after cloning: bash scripts/setup/dev.sh

set -euo pipefail

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
AMBER='\033[33m'
DIM='\033[2m'
RESET='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
warn() { echo -e "  ${AMBER}⚠${RESET} $1"; }
info() { echo -e "  ${DIM}$1${RESET}"; }
section() { echo -e "\n${BOLD}${CYAN}$1${RESET}"; }

echo -e "${BOLD}SheLLM — Dev Setup${RESET}"
echo -e "${DIM}This script prepares your local environment after cloning.${RESET}"

# ── Node.js version ──────────────────────────────────────────────────────────
section "Checking Node.js"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -ge 22 ]; then
  ok "Node.js $(node --version)"
else
  fail "Node.js $(node --version 2>/dev/null || echo 'not found') — requires >= 22"
  echo ""
  echo -e "  Install Node.js 22 via nvm:"
  echo -e "  ${DIM}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash${RESET}"
  echo -e "  ${DIM}nvm install 22 && nvm use 22${RESET}"
  echo ""
  exit 1
fi

# ── npm install ──────────────────────────────────────────────────────────────
section "Installing dependencies"

if [ -d "$ROOT/node_modules" ]; then
  ok "node_modules already present — skipping npm install"
else
  echo -e "  Running npm install..."
  (cd "$ROOT" && npm install)
  ok "Dependencies installed"
fi

# ── .env ─────────────────────────────────────────────────────────────────────
section "Configuration"

if [ -f "$ROOT/.env" ]; then
  ok ".env already exists — skipping"
else
  cp "$ROOT/.env.example" "$ROOT/.env"
  ok ".env created from .env.example"
  warn "Review .env and set SHELLM_ADMIN_PASSWORD to enable the admin dashboard"
fi

# ── npm link ─────────────────────────────────────────────────────────────────
section "CLI link"

if command -v shellm &>/dev/null; then
  ok "shellm CLI already linked ($(shellm version 2>/dev/null || echo 'unknown version'))"
else
  echo -e "  Linking shellm CLI globally..."
  (cd "$ROOT" && npm link)
  ok "shellm CLI linked — you can now run: shellm start"
fi

# ── CLI providers ─────────────────────────────────────────────────────────────
section "CLI Providers — Authentication"

echo -e "  ${DIM}Each CLI provider needs to be authenticated before SheLLM can use it."
echo -e "  You only need to auth the providers you plan to use.${RESET}"

# Claude
echo ""
if command -v claude &>/dev/null; then
  ok "claude binary found ($(claude --version 2>/dev/null | head -1 || echo 'unknown'))"
  echo -e "  ${DIM}To authenticate:  claude auth login${RESET}"
else
  warn "claude not found"
  echo -e "  ${DIM}Install:  curl -fsSL https://claude.ai/install.sh | bash${RESET}"
  echo -e "  ${DIM}Then auth: claude auth login${RESET}"
fi

# Gemini
echo ""
if command -v gemini &>/dev/null; then
  ok "gemini binary found ($(gemini --version 2>/dev/null | head -1 || echo 'unknown'))"
  echo -e "  ${DIM}To authenticate:  gemini auth login${RESET}"
else
  warn "gemini not found"
  echo -e "  ${DIM}Install:  npm install -g @google/gemini-cli${RESET}"
  echo -e "  ${DIM}Then auth: gemini auth login${RESET}"
fi

# Codex
echo ""
if command -v codex &>/dev/null; then
  ok "codex binary found ($(codex --version 2>/dev/null | head -1 || echo 'unknown'))"
  echo -e "  ${DIM}To authenticate:  codex auth login${RESET}"
else
  warn "codex not found"
  echo -e "  ${DIM}Install:  npm install -g @openai/codex${RESET}"
  echo -e "  ${DIM}Then auth: codex auth login${RESET}"
fi

# ── Final summary ─────────────────────────────────────────────────────────────
section "Done"

echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "  1. Authenticate any CLI providers above (opens browser)"
echo -e "  2. ${CYAN}npm run check:env${RESET}   — verify everything is ready"
echo -e "  3. ${CYAN}shellm start${RESET}         — start the server"
echo -e "  4. ${CYAN}curl http://127.0.0.1:6100/health${RESET}   — confirm it's running"
echo -e "  5. ${CYAN}npm test${RESET}             — run the test suite"
echo ""
echo -e "  ${DIM}Docs: CONTRIBUTING.md${RESET}"
echo ""
