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
# Where the request is moved the moment it is read. Moving rather than deleting keeps the content
# on disk for whoever has to work out why an update stopped, without leaving the trigger armed.
CLAIMED="${REQUEST}.claimed"
# Durable, not /run: the dashboard reads this *after* the restart, which is exactly when a
# rollback is the thing you want to read about.
STATUS="${STATE_DIR}/update-status.json"
# A directory this repo creates and owns. Not /var/backups/shellm: that one belongs to whoever
# provisioned the host, `install -d -o` below applies ownership to a directory that already
# exists, and taking a root-only 700 directory over reinterprets it as service-user-only —
# granting the right to delete files the service user is not even allowed to read.
BACKUP_DIR="/var/lib/shellm/backups"
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

# Written 0640 shellmer:shellmer — root writes it, the confined service reads it — through a
# temporary file so a reader never sees half of one.
write_status() {
  local finished="$1"
  local tmp="${STATUS}.tmp"
  install -m 0640 -o "${SERVICE_USER}" -g "${SERVICE_USER}" /dev/null "${tmp}"
  cat > "${tmp}" <<EOF
{
  "state": $(json_string "${state}"),
  "ref": $(json_string "${requested_ref}"),
  "commit": $(json_string "${resolved_sha}"),
  "detail": $(json_string "${detail}"),
  "started_at": $(json_string "${started_at}"),
  "finished_at": ${finished}
}
EOF
  mv -f "${tmp}" "${STATUS}"
}

# Runs on every exit, including the failures, because a button that reports nothing when it fails
# is worse than no button.
on_exit() {
  # Reaching the exit still marked "running" means `set -e` ended the script somewhere that did
  # not go through fail(). Reporting it as running would be a lie with a timestamp on it.
  if [[ ${state} == running ]]; then
    state="failed"
    detail="the updater stopped without reporting why — journalctl -u shellm-update -n 100"
  fi
  write_status "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
}
trap on_exit EXIT

# An EXIT trap does not run when the shell is killed by an untrapped signal, and this unit has a
# start timeout — so the one case most likely to leave the host half-updated is also the one that
# would report nothing. Catching the signal turns it into an exit, which runs the trap above.
on_signal() {
  state="failed"
  detail="terminated by SIG$1 — if this was the start timeout, the update may be half applied; check journalctl -u shellm-update"
  echo "ERROR: ${detail}" >&2
  exit $((128 + $2))
}
trap 'on_signal TERM 15' TERM
trap 'on_signal INT 2' INT
trap 'on_signal HUP 1' HUP

fail() {
  state="failed"
  detail="$1"
  echo "ERROR: $1" >&2
  exit 1
}

as_service_user() { runuser -u "${SERVICE_USER}" -- "$@"; }

# 1. Claim the request BEFORE doing any work, by moving it out of the watched name.
#
# PathExists= is level-triggered: while the file is there and this unit is not running, systemd
# starts it again. Clearing the request at the end would still loop on any crash before that
# line, and that loop is permanent. Clearing it first means a crashed update is one failure
# rather than an endless sequence of them.
#
# The consequence is deliberate and worth stating: a request is consumed even if the very next
# step fails, and there is no retry. An update that re-fires by itself, as root, because
# something went wrong is a worse thing to own than one that stops and says so. The status file
# below is how it says so, and pressing the button again is a person's decision.
#
# It is moved rather than deleted so the content survives for whoever has to diagnose a run that
# never reported — the one case the traps above cannot cover is SIGKILL, which cannot be caught.
# The next request overwrites it.
if [[ ! -f ${REQUEST} ]]; then
  # Report nothing and overwrite nothing. This unit can be started for a request another run
  # already claimed, and replacing the previous outcome with "there was nothing to do" would
  # erase exactly the record someone is about to go looking for.
  echo "==> No request to claim — nothing to do"
  trap - EXIT
  exit 0
fi
mv -f "${REQUEST}" "${CLAIMED}"
request="$(cat "${CLAIMED}")"

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

# Publish "running" before doing anything, with no finished_at. SIGKILL cannot be caught, so the
# traps above cover every way this can die except the one systemd uses last. A record that says
# `running` with a started_at and no end is what distinguishes "the updater was killed" from "the
# updater never started" — and a reader that finds one older than the unit's start timeout should
# treat it as failed.
state="running"
detail="applying ${requested_ref}"
write_status null

# 3. Resolve the tag to a commit id against the real repository, before anything is checked out.
#
# Checking a tag's name and then checking out that name reads as a check and is not one: shellmer
# owns .git and can point a local tag of the right name at any commit, including between the
# fetch and the checkout. A commit id cannot be hijacked — the worst a rewritten local ref
# achieves is naming an object that does not exist, which fails the update.
lines="$(git ls-remote --tags "${REPO_URL}" "refs/tags/${requested_ref}^{}" || true)"
# refs/tags/<tag>^{} only exists for an annotated tag. This repository's releases are annotated,
# so the peeled lookup is the one that answers; the fallback covers a lightweight tag, where
# there is nothing to peel and the ref already names the commit.
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
# is running. It runs as shellmer because opening a WAL database creates the -wal and -shm files
# beside it: root doing that leaves root-owned files in the service user's state directory, and
# the service cannot write its own database again until someone works out why.
if [[ -f ${STATE_DIR}/shellm.db ]]; then
  echo "==> Snapshotting the database"
  install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${BACKUP_DIR}"
  backup="${BACKUP_DIR}/shellm-$(date -u +%Y%m%dT%H%M%SZ)-before-${requested_ref}.db"
  as_service_user sqlite3 "${STATE_DIR}/shellm.db" ".backup '${backup}'" \
    || fail "could not snapshot the database — refusing to update without one"
  echo "    ${backup}"
  # Keep the last few and no more; this directory is not a backup strategy, it is an undo. The
  # glob is the runner's own naming, so sharing the directory one day could not widen this into
  # deleting a file it did not write.
  ls -1t "${BACKUP_DIR}"/shellm-*-before-*.db 2>/dev/null | tail -n +$((BACKUPS_KEPT + 1)) | xargs -r rm -f
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
