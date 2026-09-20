#!/usr/bin/env bash
# Removes what vps.sh installed. Keeps the service user and its data unless --purge is given.
# Usage: ssh root@your-vps 'bash -s -- [--purge]' < scripts/setup/vps-uninstall.sh

set -euo pipefail

SERVICE_USER="shellmer"
SERVICE_HOME="/home/${SERVICE_USER}"
PURGE=false
[[ "${1:-}" == "--purge" ]] && PURGE=true

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run this script as root." >&2
  exit 1
fi

echo "==> systemd and logrotate"
systemctl disable --now shellm-update.path 2>/dev/null || true
systemctl disable --now shellm 2>/dev/null || true
rm -f /etc/systemd/system/shellm.service /etc/logrotate.d/shellm
rm -f /etc/systemd/system/shellm-update.path /etc/systemd/system/shellm-update.service
rm -f /etc/tmpfiles.d/shellm.conf
rm -rf /usr/local/lib/shellm /run/shellm
systemctl daemon-reload

echo "==> shellm command"
npm rm -g shellm 2>/dev/null || true

if [[ "${PURGE}" == true ]]; then
  echo "==> Purging ${SERVICE_USER}"
  pkill -u "${SERVICE_USER}" 2>/dev/null || true
  userdel -r "${SERVICE_USER}"
  rm -rf /var/lib/shellm
  echo "  removed ${SERVICE_HOME}: repository, config, database, logs and Claude credentials"
  echo "  removed /var/lib/shellm: the snapshots the updater took before each update"
else
  cat <<EOF

Kept ${SERVICE_HOME}: repository, ~/.config/shellm/env, ~/.shellm (database and logs)
and the Claude login, plus /var/lib/shellm with the updater's database snapshots. Re-run
with --purge to delete the user and all of it.
EOF
fi

echo "Node.js and any tunnel or reverse proxy you configured were left untouched."
