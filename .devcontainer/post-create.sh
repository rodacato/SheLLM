#!/usr/bin/env bash
set -euo pipefail

echo "==> Ensuring node_modules ownership..."
sudo chown -R node:node /workspace/node_modules

echo "==> Installing npm dependencies..."
npm install

echo "==> Setting up Claude Code config..."
CLAUDE_PROJECT_DIR="$(pwd)/.claude"
CLAUDE_HOME="$HOME/.claude"

mkdir -p "$CLAUDE_HOME"

if [ -d "$CLAUDE_PROJECT_DIR" ]; then
  cp -rn "$CLAUDE_PROJECT_DIR/." "$CLAUDE_HOME/"
  echo "  ✓ Claude config copied from project."
else
  echo "  ✗ No .claude in project, created empty ~/.claude."
fi

echo "==> Verifying CLI tools..."
if command -v claude &>/dev/null; then
  echo "  ✓ Claude Code: $(claude --version 2>/dev/null || echo 'installed')"
else
  echo "  ⟳ Claude Code: not found — installing..."
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="/home/node/.local/bin:${PATH}"
  echo "  ✓ Claude Code: $(claude --version 2>/dev/null || echo 'installed')"
fi

if command -v gemini &>/dev/null; then
  echo "  ✓ Gemini CLI: installed"
else
  echo "  ✗ Gemini CLI: not found"
fi

if command -v codex &>/dev/null; then
  echo "  ✓ Codex CLI: installed"
else
  echo "  ✗ Codex CLI: not found"
fi

echo ""
echo "==> Dev container ready!"
echo "    Run 'npm run dev' to start the server on :8000"
echo "    Run 'npm test' to run the test suite"
