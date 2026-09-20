'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const { insertAuditLog } = require('../db');
const { getBuildInfo } = require('../infra/build-info');
const {
  TAG_PATTERN,
  triggerState,
  lastStatus,
  requestPending,
  compareVersions,
  isMajorJump,
  requestUpdate,
} = require('../infra/updater');
const logger = require('../lib/logger');

const router = Router();

// What the operator has to do next, per state. The dashboard shows these verbatim, because
// "the updater is not enabled" sends half of the people who read it to the wrong command.
const TRIGGER_HELP = {
  unavailable: 'This host has no systemd, so there is nothing to trigger. Update it however it was installed.',
  not_installed: 'The updater units are not installed. Re-run scripts/setup/vps.sh on the host.',
  disabled: 'The updater is installed but not enabled. Run: sudo systemctl enable --now shellm-update.path',
  ready: null,
};

// GET /admin/update — can this host update itself, and what happened last time it tried
router.get('/update', (_req, res) => {
  const trigger = triggerState();
  const build = getBuildInfo();
  res.json({
    trigger,
    trigger_help: TRIGGER_HELP[trigger],
    running: { version: build.version, commit: build.commit },
    pending: requestPending(),
    last: lastStatus(),
  });
});

// POST /admin/update — write the request. It does not deploy; a root unit does, or nothing does.
router.post('/update', (req, res) => {
  const { ref, confirm } = req.body || {};

  if (typeof ref !== 'string' || !TAG_PATTERN.test(ref)) {
    return sendError(res, invalidRequest('Field "ref" must be a release tag of the form vX.Y.Z'), req.requestId);
  }

  const trigger = triggerState();
  if (trigger !== 'ready') {
    return sendError(res, {
      status: 409, code: 'updater_unavailable', message: TRIGGER_HELP[trigger],
    }, req.requestId);
  }

  // A request already on disk is either waiting for a disabled trigger or queued behind a run in
  // flight. Either way, writing a second one replaces the first with no trace of the swap.
  if (requestPending()) {
    return sendError(res, {
      status: 409, code: 'update_pending', message: 'An update request is already waiting to be picked up',
    }, req.requestId);
  }

  const last = lastStatus();
  if (last && last.state === 'running' && !last.stalled) {
    return sendError(res, {
      status: 409, code: 'update_running', message: `An update to ${last.ref} is still running`,
    }, req.requestId);
  }

  const current = getBuildInfo().version;
  const direction = compareVersions(ref, current);
  if (direction === null) {
    return sendError(res, invalidRequest(`Cannot compare ${ref} against the running version ${current}`), req.requestId);
  }
  // Rolling back is a real need and it stays on the SSH path (`SHELLM_REF=vX.Y.Z sudo shellm
  // update`), where a person is already looking at the host. Offering it here would make the
  // worst outcome of a forged request "downgrade to a release with a known hole" instead of
  // "update to the newest one".
  if (direction <= 0) {
    return sendError(res, {
      status: 409,
      code: 'not_an_upgrade',
      message: direction === 0
        ? `This host already runs ${ref}`
        : `${ref} is older than the running ${current}. Roll back over SSH: SHELLM_REF=${ref} sudo shellm update`,
    }, req.requestId);
  }

  // A major jump is the case where migrations can be one-way, so it asks for the version to be
  // typed. The snapshot the runner takes is what makes it reversible at all.
  if (isMajorJump(ref, current) && confirm !== ref) {
    return sendError(res, {
      status: 409,
      code: 'confirmation_required',
      message: `${ref} is a major version jump. Send "confirm" set to ${ref} to proceed.`,
    }, req.requestId);
  }

  try {
    requestUpdate(ref, current);
  } catch (err) {
    // The most likely cause by far, and it has a specific fix: /run/shellm exists but the
    // service's mount namespace was built before it did, so the sandbox still sees /run read-only.
    return sendError(res, {
      status: 500,
      code: 'request_not_written',
      message: `Could not write the update request: ${err.message}. If this says read-only, restart the service so its sandbox picks up /run/shellm.`,
    }, req.requestId);
  }

  insertAuditLog({ action: 'request', resource: 'update', resource_id: ref, details: JSON.stringify({ from: current }) });
  logger.info({ event: 'update_requested', from: current, to: ref });
  res.status(202).json({ requested: ref, from: current });
});

module.exports = router;
