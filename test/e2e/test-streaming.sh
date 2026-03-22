#!/usr/bin/env bash
# End-to-end streaming test — run against a live SheLLM server.
# Usage: ./test/e2e/test-streaming.sh [BASE_URL]
# Default: http://127.0.0.1:3777

set -euo pipefail

BASE="${1:-http://127.0.0.1:3777}"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "Testing streaming against $BASE"
echo ""

# --- Test 1: Non-streaming still works ---
echo "1. Non-streaming request"
RESP=$(curl -s -w '\n%{http_code}' "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude","messages":[{"role":"user","content":"say hello"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$CODE" = "200" ]; then ok "status 200"; else fail "expected 200, got $CODE"; fi
if echo "$BODY" | grep -q '"chat.completion"'; then ok "object=chat.completion"; else fail "wrong object type"; fi

# --- Test 2: Streaming returns SSE ---
echo ""
echo "2. Streaming request"
STREAM=$(curl -s -N --max-time 120 "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude","stream":true,"messages":[{"role":"user","content":"say hello in one word"}]}')

if echo "$STREAM" | grep -q 'data: '; then ok "received SSE data lines"; else fail "no SSE data lines"; fi
if echo "$STREAM" | grep -q 'chat.completion.chunk'; then ok "object=chat.completion.chunk"; else fail "wrong chunk object"; fi
if echo "$STREAM" | grep -q '"role":"assistant"'; then ok "first chunk has role"; else fail "missing role in first chunk"; fi
if echo "$STREAM" | grep -q '"finish_reason":"stop"'; then ok "has finish_reason stop"; else fail "missing finish_reason"; fi
if echo "$STREAM" | grep -q 'data: \[DONE\]'; then ok "ends with [DONE]"; else fail "missing [DONE]"; fi

# --- Test 3: Invalid request returns 400 even with stream ---
echo ""
echo "3. Invalid streaming request"
INVALID=$(curl -s -w '\n%{http_code}' "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"hi"}]}')
ICODE=$(echo "$INVALID" | tail -1)
if [ "$ICODE" = "400" ]; then ok "returns 400 for missing model"; else fail "expected 400, got $ICODE"; fi

# --- Test 4: Gemini buffer-and-flush fallback ---
echo ""
echo "4. Buffer-and-flush fallback (gemini)"
GEMINI=$(curl -s -N --max-time 120 "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemini","stream":true,"messages":[{"role":"user","content":"say hello in one word"}]}')

if echo "$GEMINI" | grep -q 'data: \[DONE\]'; then ok "gemini stream ends with [DONE]"; else fail "gemini missing [DONE]"; fi
if echo "$GEMINI" | grep -q 'chat.completion.chunk'; then ok "gemini returns chunks"; else fail "gemini no chunks"; fi

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
