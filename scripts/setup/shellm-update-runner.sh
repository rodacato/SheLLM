#!/usr/bin/env bash
# The privileged half of the dashboard's update button.
#
# shellm-update.path sees /run/shellm/update-request.json appear and starts shellm-update.service,
# which runs this as root. vps.sh installs it to /usr/local/lib/shellm/, outside the checkout, so
# that what a root unit executes is not something the service user can rewrite.
#
# Everything here is a wrapper. Validate the request, resolve the tag to a commit id against the
# real repository, snapshot the database, hand the id to the CLI, report what happened. The update
# sequence itself — fetch, checkout, npm ci, migrations, unit, restart, health check, rollback —
# stays in src/cli/update.js. A second copy of it here would diverge from the first, which is the
# reason ADR-0003 rejected reimplementing it.
#
# See docs/adr/0003-release-and-update-cycle.md.

set -euo pipefail

# Literal, never the checkout's "origin": .git/config belongs to shellmer, so a script that
# fetches from origin lets the least privileged half choose where the code comes from.
REPO_URL="https://github.com/rodacato/SheLLM.git"
SERVICE_USER="shellmer"
APP_DIR="/home/${SERVICE_USER}/shellm"
STATE_DIR="/home/${SERVICE_USER}/.shellm"
REQUEST="/run/shellm/update-request.json"
# Durable, not /run: the dashboard reads this *after* the restart, which is exactly when a
# rollback is the thing you want to read about.
STATUS="${STATE_DIR}/update-status.json"
BACKUP_DIR="/var/backups/shellm"
BACKUPS_KEPT=5

# git reads configuration from the current directory's repository. Root has no business picking
# any of it up from a tree shellmer owns.
cd /

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
requested_ref=""
resolved_sha=""
state="failed"
detail="the updater exited before it reported anything"

json_string() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/ }
  s=${s//$'\t'/ }
  printf '"%s"' "${s}"
}

# Runs on every exit, including the failures, because a button that reports nothing when it fails
# is worse than no button. Written 0640 shellmer:shellmer: root writes it, the confined service
# reads it.
write_status() {
  local tmp="${STATUS}.tmp"
  install -m 0640 -o "${SERVICE_USER}" -g "${SERVICE_USER}" /dev/null "${tmp}"
  cat > "${tmp}" <<EOF
{
  "state": $(json_string "${state}"),
  "ref": $(json_string "${requested_ref}"),
  "commit": $(json_string "${resolved_sha}"),
  "detail": $(json_string "${detail}"),
  "started_at": $(json_string "${started_at}"),
  "finished_at": $(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
}
EOF
  mv -f "${tmp}" "${STATUS}"
}
trap write_status EXIT

fail() {
  state="failed"
  detail="$1"
  echo "ERROR: $1" >&2
  exit 1
}

as_service_user() { runuser -u "${SERVICE_USER}" -- "$@"; }

# 1. Take the request and delete it BEFORE doing any work.
#
# PathExists= is level-triggered: while the file is there and this unit is not running, systemd
# starts it again. Deleting the request at the end would still loop on any crash before that
# line, and a loop is permanent. Deleting it first means a crashed update is one failure, not an
# endless sequence of them.
if [[ ! -f ${REQUEST} ]]; then
  state="skipped"
  detail="no request file — the trigger fired for something that was already handled"
  exit 0
fi
request="$(cat "${REQUEST}")"
rm -f "${REQUEST}"

# 2. Parse and validate in one step. The pattern is the validation: nothing that is not shaped
# like a release tag can come out of it, whatever the file contains.
requested_ref="$(
  printf '%s' "${request}" \
    | grep -oE '"ref"[[:space:]]*:[[:space:]]*"v[0-9]+\.[0-9]+\.[0-9]+"' \
    | head -1 \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+'
)" || true
[[ -n ${requested_ref} ]] || fail "the request names no release tag of the form vX.Y.Z"

echo "==> Requested ${requested_ref}"

# 3. Resolve the tag to a commit id against the real repository, before anything is checked out.
#
# Checking a tag's name and then checking out that name reads as a check and is not one: shellmer
# owns .git and can point a local tag of the right name at any commit, including between the
# fetch and the checkout. A commit id cannot be hijacked — the worst a rewritten local ref
# achieves is naming an object that does not exist, which fails the update.
lines="$(git ls-remote --tags "${REPO_URL}" "refs/tags/${requested_ref}^{}" || true)"
# refs/tags/<tag>^{} only exists for annotated tags; this repository's are lightweight, so the
# peeled lookup comes back empty for them and the unpeeled one is the answer.
[[ -n ${lines} ]] || lines="$(git ls-remote --tags "${REPO_URL}" "refs/tags/${requested_ref}" || true)"
[[ -n ${lines} ]] || fail "no tag ${requested_ref} in ${REPO_URL}"
[[ $(printf '%s\n' "${lines}" | wc -l) -eq 1 ]] || fail "${requested_ref} matches more than one ref"
resolved_sha="$(printf '%s' "${lines}" | cut -f1)"
[[ ${resolved_sha} =~ ^[0-9a-f]{40}$ ]] || fail "ls-remote returned something that is not a commit id"

echo "    resolves to ${resolved_sha}"

# `shellm update` fetches from origin before it resolves the ref, so origin has to be the URL this
# id was resolved against. Set as shellmer, because .git/config is theirs and a root-owned config
# file would break the next update.
as_service_user git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"

# 4. Snapshot the database. WAL mode means cp is not a backup; .backup is safe while the service
# is running, and it runs as shellmer because the database is theirs.
if [[ -f ${STATE_DIR}/shellm.db ]]; then
  echo "==> Snapshotting the database"
  install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${BACKUP_DIR}"
  backup="${BACKUP_DIR}/shellm-$(date -u +%Y%m%dT%H%M%SZ)-before-${requested_ref}.db"
  as_service_user sqlite3 "${STATE_DIR}/shellm.db" ".backup '${backup}'" \
    || fail "could not snapshot the database — refusing to update without one"
  echo "    ${backup}"
  # Keep the last few and no more; this directory is not a backup strategy, it is an undo.
  ls -1t "${BACKUP_DIR}"/shellm-*.db 2>/dev/null | tail -n +$((BACKUPS_KEPT + 1)) | xargs -r rm -f
else
  echo "==> No database yet — nothing to snapshot"
fi

# 5. Hand the commit id to the CLI, which owns the sequence.
shellm_bin="$(command -v shellm)" || fail "shellm is not on the updater's PATH"
echo "==> ${shellm_bin} update"
SHELLM_REF="${resolved_sha}" "${shellm_bin}" update \
  || fail "shellm update failed — it rolls back on its own; journalctl -u shellm-update -n 100"

# 6. Confirm the checkout is where it was told to go. This detects the case the resolution above
# is designed around, rather than assuming it worked.
head="$(as_service_user git -C "${APP_DIR}" rev-parse HEAD)"
[[ ${head} == "${resolved_sha}" ]] \
  || fail "the checkout is at ${head}, not the requested ${resolved_sha}"

state="ok"
detail="running ${requested_ref}"
echo "==> Done: ${detail}"
