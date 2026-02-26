#!/usr/bin/env bash
# check-auth.sh — Non-interactive auth verification for SheLLM CLI providers.
# Usage: docker exec shellm bash scripts/check-auth.sh
#
# Exit codes:
#   0 — All installed CLI providers are authenticated
#   1 — One or more installed providers are NOT authenticated
#   2 — No CLI providers installed

set -uo pipefail

if [[ -z "${NO_COLOR:-}" ]]; then
  GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m' RESET='\033[0m'
else
  GREEN='' RED='' YELLOW='' RESET=''
fi

ISSUES=0
CHECKED=0

check_provider() {
  local name="$1" cmd="$2"
  shift 2

  if ! command -v "$cmd" &>/dev/null; then
    echo -e "  ${YELLOW}[-]${RESET} ${name}: not installed"
    return 0
  fi

  CHECKED=$((CHECKED + 1))

  if "$cmd" "$@" &>/dev/null; then
    echo -e "  ${GREEN}[+]${RESET} ${name}: authenticated"
  else
    echo -e "  ${RED}[x]${RESET} ${name}: installed but NOT authenticated"
    ISSUES=$((ISSUES + 1))
  fi
}

check_cerebras() {
  if [[ -n "${CEREBRAS_API_KEY:-}" ]]; then
    echo -e "  ${GREEN}[+]${RESET} cerebras: API key set"
  else
    echo -e "  ${YELLOW}[-]${RESET} cerebras: CEREBRAS_API_KEY not set (optional)"
  fi
}

echo "SheLLM Auth Check"
echo "================="
echo ""

check_provider "claude" "claude" "--version"
check_provider "gemini" "gemini" "--version"
check_provider "codex"  "codex"  "--version"
check_cerebras

echo ""

if [[ $ISSUES -eq 0 ]]; then
  if [[ $CHECKED -eq 0 ]]; then
    echo "No CLI providers installed."
    exit 2
  fi
  echo "All ${CHECKED} installed provider(s) OK."
  exit 0
else
  echo "${ISSUES} provider(s) need authentication."
  echo "Run: docker exec -it shellm bash scripts/setup-auth.sh"
  exit 1
fi
