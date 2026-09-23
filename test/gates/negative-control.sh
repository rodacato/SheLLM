#!/usr/bin/env bash
# Breaks each documentation gate's invariant on purpose and checks the gate notices.
# Not wired into CI: it mutates tracked files and restores them, so it is run by hand after
# changing a gate. A gate that has never failed is not evidence of anything.

set -uo pipefail
cd "$(dirname "$0")/../.."

BACKUP="$(mktemp -d)"
FAILED=0

cp CHANGELOG.md "$BACKUP/CHANGELOG.md"
cp docs/guides/architecture.md "$BACKUP/architecture.md"
cp .env.example "$BACKUP/env.example"
cp docs/api/bundled.json "$BACKUP/bundled.json"
cp docs/api/openapi.yaml "$BACKUP/openapi.yaml"

restore() {
  cp "$BACKUP/CHANGELOG.md" CHANGELOG.md
  cp "$BACKUP/architecture.md" docs/guides/architecture.md
  cp "$BACKUP/env.example" .env.example
  cp "$BACKUP/bundled.json" docs/api/bundled.json
  cp "$BACKUP/openapi.yaml" docs/api/openapi.yaml
  rm -rf "$BACKUP"
}
trap restore EXIT

run_test() {
  node --experimental-test-module-mocks --test "$1" >/dev/null 2>&1
}

expect_break() {
  local name="$1" file="$2"
  if run_test "$file"; then
    echo "NOT CAUGHT: $name passed with its invariant broken"
    FAILED=1
  else
    echo "caught: $name"
  fi
}

# 1. A version heading whose comparison link was dropped.
sed -i '/^\[1\.8\.0\]:/d' CHANGELOG.md
expect_break "changelog links" test/docs/changelog-links.test.js
cp "$BACKUP/CHANGELOG.md" CHANGELOG.md

# 2. A module the guide names and the tree does not contain.
sed -i 's|└── time\.js|└── log-emitter.js|' docs/guides/architecture.md
expect_break "architecture paths" test/docs/doc-paths.test.js
cp "$BACKUP/architecture.md" docs/guides/architecture.md

# 3. A variable src/ reads that .env.example stops documenting.
sed -i '/^# SHELLM_QUOTA_WINDOW_HOURS=/d' .env.example
expect_break "documented configuration" test/docs/env-documented.test.js
cp "$BACKUP/env.example" .env.example

# 4. A spec source edited without rebuilding the bundle the server serves.
sed -i 's|^  title: .*|  title: Drifted|' docs/api/openapi.yaml
npm run docs:build >/dev/null 2>&1
if git diff --quiet docs/api/bundled.json; then
  echo "NOT CAUGHT: bundle drift produced no diff"
  FAILED=1
else
  echo "caught: bundle drift"
fi
restore
trap - EXIT

if [ "$FAILED" -ne 0 ]; then
  echo "SOME_GATES_CANNOT_FAIL"
  exit 1
fi

echo "ALL_GATES_CAN_FAIL"
