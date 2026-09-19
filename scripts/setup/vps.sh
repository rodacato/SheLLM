#!/usr/bin/env bash
# Provisions SheLLM on a Debian/Ubuntu VPS; safe to re-run. Undo with vps-uninstall.sh.
# Usage: ssh root@your-vps 'bash -s' < scripts/setup/vps.sh

set -euo pipefail

REPO="${SHELLM_REPO:-https://github.com/rodacato/SheLLM.git}"
SHELLM_REF="${SHELLM_REF:-}"
CLAUDE_VERSION="${CLAUDE_VERSION:-2.1.273}"
CODEX_VERSION="${CODEX_VERSION:-0.154.0}"
SERVICE_USER="shellmer"
SERVICE_HOME="/home/${SERVICE_USER}"
APP_DIR="${SERVICE_HOME}/shellm"
# The service user cannot write a root-owned global prefix; this one is already on the unit's PATH.
NPM_PREFIX="${SERVICE_HOME}/.npm-global"
CONFIG_FILE="${SERVICE_HOME}/.config/shellm/env"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run this script as root." >&2
  exit 1
fi

as_service_user() { sudo -u "${SERVICE_USER}" -H bash -c "$1"; }

echo "==> Service user"
if id "${SERVICE_USER}" &>/dev/null; then
  echo "  ${SERVICE_USER} already exists"
else
  useradd -m -s /bin/bash "${SERVICE_USER}"
  echo "  created ${SERVICE_USER}"
fi

echo "==> Node.js 24"
if node --version 2>/dev/null | grep -q "^v24"; then
  echo "  $(node --version) already installed"
else
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
  echo "  installed $(node --version)"
fi

echo "==> Claude Code ${CLAUDE_VERSION}"
as_service_user "curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_VERSION}"

echo "==> Codex ${CODEX_VERSION}"
if as_service_user "${NPM_PREFIX}/bin/codex --version 2>/dev/null" | grep -qFw "${CODEX_VERSION}"; then
  echo "  codex ${CODEX_VERSION} already installed"
else
  as_service_user "npm install -g --prefix ${NPM_PREFIX} @openai/codex@${CODEX_VERSION}"
  echo "  installed codex ${CODEX_VERSION}"
fi

# A host follows published releases, not the tip of a branch, so what it runs has a name and
# release notes. SHELLM_REF deploys a branch or an older tag deliberately.
resolve_ref() {
  if [[ -n "${SHELLM_REF}" ]]; then
    echo "${SHELLM_REF}"
    return
  fi
  local latest
  latest=$(as_service_user "git -C ${APP_DIR} tag -l 'v*' --sort=-v:refname" | head -1)
  # A repository with no tags yet still has to install; it follows the default branch.
  echo "${latest:-$(as_service_user "git -C ${APP_DIR} symbolic-ref --short refs/remotes/origin/HEAD" | sed 's|^origin/||')}"
}

echo "==> SheLLM"
if [[ ! -d "${APP_DIR}/.git" ]]; then
  as_service_user "git clone ${REPO} ${APP_DIR}"
fi
as_service_user "git -C ${APP_DIR} fetch --tags --force --prune origin"
REF=$(resolve_ref)
echo "  checking out ${REF}"
as_service_user "git -C ${APP_DIR} checkout --detach ${REF}"
as_service_user "cd ${APP_DIR} && npm ci --omit=dev"
(cd "${APP_DIR}" && npm link)
as_service_user "mkdir -p ~/.shellm/logs"

echo "==> Config"
as_service_user "mkdir -p -m 700 $(dirname "${CONFIG_FILE}")"
if [[ ! -f "${CONFIG_FILE}" && -f "${APP_DIR}/.env" ]]; then
  mv "${APP_DIR}/.env" "${CONFIG_FILE}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_FILE}"
  chmod 600 "${CONFIG_FILE}"
  echo "  moved ${APP_DIR}/.env to ${CONFIG_FILE}"
fi

echo "==> systemd and logrotate"
cp "${APP_DIR}/shellm.service" /etc/systemd/system/shellm.service
cp "${APP_DIR}/config/logrotate.conf" /etc/logrotate.d/shellm
systemctl daemon-reload
systemctl enable shellm

echo "==> Update trigger"
# The units are installed but not enabled: they are how the dashboard reaches a root process,
# and that is the operator's decision to make. The runner goes outside the checkout, where
# shellmer cannot rewrite what a root unit executes.
cp "${APP_DIR}/config/systemd/shellm-update.service" /etc/systemd/system/shellm-update.service
cp "${APP_DIR}/config/systemd/shellm-update.path" /etc/systemd/system/shellm-update.path
install -D -m 0755 -o root -g root \
  "${APP_DIR}/scripts/setup/shellm-update-runner.sh" /usr/local/lib/shellm/shellm-update-runner.sh
cp "${APP_DIR}/config/tmpfiles.d/shellm.conf" /etc/tmpfiles.d/shellm.conf
systemctl daemon-reload

# ProtectSystem=strict mounts the whole of /run read-only inside the service's namespace, and
# ReadWritePaths=-/run/shellm is skipped while the directory does not exist. The namespace is
# built when the service starts — so a service that was already running when /run/shellm first
# appeared still cannot write there, and the update request fails silently rather than loudly.
# At boot this never happens: systemd-tmpfiles-setup runs before the services. The upgrade path
# is the one that needs the restart, and it is the path every existing install takes.
RUNDIR_EXISTED=true
[[ -d /run/shellm ]] || RUNDIR_EXISTED=false
systemd-tmpfiles --create /etc/tmpfiles.d/shellm.conf
if [[ "${RUNDIR_EXISTED}" == false ]] && systemctl is-active --quiet shellm; then
  echo "  /run/shellm is new — restarting shellm so its sandbox includes it"
  systemctl restart shellm
fi
echo "  installed; enable it with: systemctl enable --now shellm-update.path"

cat <<EOF

SheLLM is installed but not started. Next:

  1. sudo -iu ${SERVICE_USER} shellm init
       Creates ${CONFIG_FILE}, asks for the token from \`claude setup-token\`
       (run that as ${SERVICE_USER} too), creates the first API key and runs the checks.
  2. sudo systemctl start shellm
  3. sudo -iu ${SERVICE_USER} shellm doctor --live

SheLLM listens on 127.0.0.1:6100. Expose it through your own tunnel or reverse proxy.

Updating from the dashboard is off until you turn it on:

  sudo systemctl enable --now shellm-update.path

That lets the dashboard ask a root unit to run \`shellm update\`. Without it the button reports
that the updater is not enabled, and \`sudo shellm update\` over SSH keeps working either way.
EOF
