#!/usr/bin/env bash
# setup-auth.sh — Interactive auth setup for SheLLM CLI providers.
# Usage: docker exec -it shellm bash scripts/setup-auth.sh
#
# Walks through each CLI tool's authentication flow.
# Requires an interactive terminal (docker exec -it).

set -euo pipefail

if [[ -z "${NO_COLOR:-}" ]]; then
  BOLD='\033[1m' GREEN='\033[0;32m' RED='\033[0;31m' RESET='\033[0m'
else
  BOLD='' GREEN='' RED='' RESET=''
fi

info() { echo -e "${BOLD}==> $1${RESET}"; }
ok()   { echo -e "  ${GREEN}[ok]${RESET} $1"; }
fail() { echo -e "  ${RED}[fail]${RESET} $1"; }

if [[ ! -t 0 ]]; then
  echo "ERROR: This script requires an interactive terminal."
  echo "Usage: docker exec -it shellm bash scripts/setup-auth.sh"
  exit 1
fi

echo ""
info "SheLLM Auth Setup"
echo ""
echo "This will walk you through authenticating each CLI provider."
echo "Skip any provider by pressing Ctrl+C during its auth flow."
echo ""

setup_claude() {
  info "1/3: Claude Code"
  if ! command -v claude &>/dev/null; then
    fail "claude not found — skipping"
    return 1
  fi
  echo "  Follow the browser prompts to authenticate."
  echo ""
  if claude auth login; then
    ok "Claude Code authenticated"
  else
    fail "Claude Code auth failed or cancelled"
  fi
  echo ""
}

setup_gemini() {
  info "2/3: Gemini CLI"
  if ! command -v gemini &>/dev/null; then
    fail "gemini not found — skipping"
    return 1
  fi
  echo "  Follow the browser/device code prompts to authenticate."
  echo ""
  if gemini auth login; then
    ok "Gemini CLI authenticated"
  else
    fail "Gemini CLI auth failed or cancelled"
  fi
  echo ""
}

setup_codex() {
  info "3/3: Codex CLI"
  if ! command -v codex &>/dev/null; then
    fail "codex not found — skipping"
    return 1
  fi
  echo "  Follow the prompts to authenticate with OpenAI."
  echo ""
  if codex auth login; then
    ok "Codex CLI authenticated"
  else
    fail "Codex CLI auth failed or cancelled"
  fi
  echo ""
}

setup_claude || true
setup_gemini || true
setup_codex  || true

echo ""
info "Verifying auth status..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/check-auth.sh" || true

echo ""
info "Done. Auth tokens persist in Docker volumes across restarts."
echo ""
