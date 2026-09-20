'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const { SHELLM_DIR } = require('../cli/paths');

// The two halves of the contract in docs/adr/0003-release-and-update-cycle.md. The request is on
// tmpfs so it cannot outlive a reboot; the status is durable because it is read after the restart.
const REQUEST_FILE = '/run/shellm/update-request.json';
const STATUS_FILE = path.join(SHELLM_DIR, 'update-status.json');
const TRIGGER_UNIT = 'shellm-update.path';

// The same shape the root runner enforces. Checking it here too is not redundant: it turns a
// typo into a message on the page instead of a request that fails minutes later in a journal.
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

// Past this, a run that still says "running" was killed outright — SIGKILL is the one exit the
// runner cannot report. It matches TimeoutStartSec= in shellm-update.service.
const RUN_TIMEOUT_MS = 900 * 1000;

const STATE_TTL_MS = 15 * 1000;
let cachedState = null;

// Whether the host can be updated from here is three states, not two, and the dashboard has to
// tell them apart because the operator's next move differs for each:
//
//   unavailable   — no systemd to ask (a container, a dev box). Nothing to offer.
//   not_installed — the units never arrived. Re-run scripts/setup/vps.sh.
//   disabled      — installed and deliberately off. systemctl enable --now shellm-update.path
//   ready         — armed.
//
// `is-active` alone cannot separate the middle two: it answers `inactive` for a unit that was
// never installed exactly as it does for one that is installed and disabled. Sending someone to
// `enable` a unit that does not exist is the kind of instruction that wastes an afternoon.
function triggerState() {
  if (cachedState && Date.now() - cachedState.at < STATE_TTL_MS) return cachedState.value;
  const value = probeTrigger();
  cachedState = { value, at: Date.now() };
  return value;
}

function probeTrigger() {
  const listed = systemctl(['list-unit-files', TRIGGER_UNIT]);
  if (listed === null) return 'unavailable';
  if (!listed.includes(TRIGGER_UNIT)) return 'not_installed';
  return systemctl(['is-active', TRIGGER_UNIT]) === 'active' ? 'ready' : 'disabled';
}

// Reading systemd's state needs no privilege and works inside the service's sandbox — verified on
// the host, because `ProtectSystem=strict` makes that a fair question to ask.
function systemctl(args) {
  try {
    return execFileSync('systemctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (err) {
    // A non-zero exit is an answer (`is-active` says `inactive` that way). No binary at all is not.
    if (err.code === 'ENOENT') return null;
    return typeof err.stdout === 'string' ? err.stdout.trim() : '';
  }
}

function resetTriggerState() {
  cachedState = null;
}

// The last outcome the runner reported, or null if it has never run. A `running` record older
// than the unit's start timeout is reported as stalled rather than as progress: the runner traps
// every signal it can, so one that stopped reporting was killed with the one it cannot.
function lastStatus() {
  let raw;
  try {
    raw = readFileSync(STATUS_FILE, 'utf8');
  } catch {
    return null;
  }
  let status;
  try {
    status = JSON.parse(raw);
  } catch {
    return { state: 'unknown', detail: 'the updater wrote a status this dashboard cannot parse' };
  }
  const startedAt = Date.parse(status.started_at);
  const stalled = status.state === 'running'
    && Number.isFinite(startedAt)
    && Date.now() - startedAt > RUN_TIMEOUT_MS;
  return { ...status, stalled };
}

// A request still sitting in the watched path means the trigger has not consumed it yet — either
// it is disabled, or an update is in flight and systemd will re-evaluate when it ends.
function requestPending() {
  return existsSync(REQUEST_FILE);
}

function parseVersion(tag) {
  const parts = tag.replace(/^v/, '').split('.').map(Number);
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

// Positive when `tag` is newer than `current`.
function compareVersions(tag, current) {
  const a = parseVersion(tag);
  const b = parseVersion(current);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function isMajorJump(tag, current) {
  const a = parseVersion(tag);
  const b = parseVersion(current);
  return a && b ? a[0] > b[0] : false;
}

// Writes the request and nothing else. Every check here is about refusing to ask for something
// the root runner would have to reject anyway, or that the operator did not mean.
//
// Writing through a temporary name matters: the trigger watches for the file to *exist*, so a
// partially written one would be picked up mid-write.
function requestUpdate(tag, currentVersion) {
  const tmp = `${REQUEST_FILE}.writing`;
  writeFileSync(tmp, `${JSON.stringify({ ref: tag, requested_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o640 });
  try {
    renameSync(tmp, REQUEST_FILE);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* the failure below is the one worth reporting */ }
    throw err;
  }
  return { ref: tag, current: currentVersion };
}

module.exports = {
  REQUEST_FILE,
  STATUS_FILE,
  TRIGGER_UNIT,
  TAG_PATTERN,
  RUN_TIMEOUT_MS,
  triggerState,
  resetTriggerState,
  lastStatus,
  requestPending,
  compareVersions,
  isMajorJump,
  requestUpdate,
};
