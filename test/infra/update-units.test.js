'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// The update trigger is four files that only ever run together, on a host, as root. Nothing in
// the test suite executes them, so what is left to protect is the set of properties that were
// argued for and that a later edit would quietly undo. Each assertion below names the failure it
// exists to prevent.
const root = path.join(__dirname, '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const PATH_UNIT = read('config/systemd/shellm-update.path');
const SERVICE_UNIT = read('config/systemd/shellm-update.service');
const TMPFILES = read('config/tmpfiles.d/shellm.conf');
const RUNNER = read('scripts/setup/shellm-update-runner.sh');
const SHELLM_UNIT = read('shellm.service');
const VPS = read('scripts/setup/vps.sh');

// systemd accumulates repeated directives, so every key maps to a list.
function parseUnit(text) {
  const directives = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    (directives[trimmed.slice(0, eq)] ||= []).push(trimmed.slice(eq + 1));
  }
  return directives;
}

describe('shellm-update.path', () => {
  const unit = parseUnit(PATH_UNIT);

  it('watches the request with a level-triggered condition', () => {
    assert.ok(
      unit.PathExists,
      'PathChanged= is edge-triggered: a request written while an update is running is dropped, '
      + 'and the dashboard has no way to know the updater was busy',
    );
    assert.ok(!unit.PathChanged, 'PathChanged= silently loses requests made during an update');
  });

  it('starts the updater and nothing else', () => {
    assert.deepEqual(unit.Unit, ['shellm-update.service']);
  });

  it('waits for the directory it watches to exist', () => {
    assert.ok(
      (unit.After || []).some((v) => v.includes('systemd-tmpfiles-setup')),
      'without this the unit can start before /run/shellm exists and falls back to watching /run',
    );
  });
});

describe('shellm-update.service', () => {
  const unit = parseUnit(SERVICE_UNIT);

  it('gives the update longer than the 90 s default to finish', () => {
    const [timeout] = unit.TimeoutStartSec || [];
    assert.ok(timeout, 'a Type=oneshot inherits DefaultTimeoutStartUSec, which is 90 s on a stock box');
    assert.ok(
      Number(timeout) >= 600,
      `TimeoutStartSec=${timeout} is short enough that a cold npm cache gets SIGTERM mid-update, `
      + 'which leaves the new code on disk and the old process serving it',
    );
  });

  it('does not order itself against the service it restarts', () => {
    for (const key of ['After', 'Before', 'Requires', 'Wants', 'BindsTo']) {
      for (const value of unit[key] || []) {
        assert.ok(
          !/\bshellm\.service\b/.test(value),
          `${key}=${value} makes \`systemctl restart shellm\` wait on the unit issuing it`,
        );
      }
    }
  });

  it('rate-limits its own starts', () => {
    assert.ok(
      unit.StartLimitBurst && unit.StartLimitIntervalSec,
      'PathExists= re-triggers while the request is on disk; without a limiter a stuck request '
      + 'hammers the box instead of failing',
    );
  });

  it('executes something the service user cannot rewrite', () => {
    const [execStart] = unit.ExecStart;
    const appDir = SHELLM_UNIT.match(/^WorkingDirectory=(.+)$/m)[1];
    assert.ok(
      !execStart.startsWith(appDir),
      `ExecStart=${execStart} is inside the checkout, which ${parseUnit(SHELLM_UNIT).User[0]} owns`,
    );
    assert.ok(execStart.startsWith('/usr/'), `ExecStart=${execStart} should live in a root-owned tree`);
  });

  it('looks binaries up on a PATH of root-owned directories only', () => {
    const [envPath] = (unit.Environment || []).filter((v) => v.startsWith('PATH=')).map((v) => v.slice(5));
    assert.ok(envPath, 'the runner resolves `shellm` on PATH, so PATH cannot be inherited');
    for (const dir of envPath.split(':')) {
      assert.ok(!dir.startsWith('/home/'), `${dir} is on the updater's PATH and is not root-owned`);
    }
  });
});

describe('the four pieces agree on one path', () => {
  const watched = parseUnit(PATH_UNIT).PathExists[0];

  it('is the path the runner reads and deletes', () => {
    assert.ok(
      RUNNER.includes(`REQUEST="${watched}"`),
      `the unit watches ${watched}; the runner reads somewhere else, so the trigger never clears`,
    );
  });

  it('lives in the directory tmpfiles creates', () => {
    const [, dir, mode, user] = TMPFILES.match(/^d\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/m);
    assert.equal(path.dirname(watched), dir);
    assert.equal(mode, '0750');
    assert.equal(
      user,
      parseUnit(SHELLM_UNIT).User[0],
      'the writer is the confined service; a directory it does not own is a button that cannot fire',
    );
  });

  it('is granted back by the sandbox that otherwise mounts /run read-only', () => {
    const writable = (parseUnit(SHELLM_UNIT).ReadWritePaths || [])
      .flatMap((v) => v.split(/\s+/))
      .map((p) => p.replace(/^-/, ''));
    assert.ok(
      writable.includes(path.dirname(watched)),
      'ProtectSystem=strict makes all of /run read-only inside the namespace',
    );
  });
});

describe('the runner', () => {
  const at = (needle) => {
    const i = RUNNER.indexOf(needle);
    assert.notEqual(i, -1, `the runner no longer contains ${needle}`);
    return i;
  };

  it('claims the request before it does any work', () => {
    assert.ok(
      at('mv -f "${REQUEST}" "${CLAIMED}"') < at('git ls-remote'),
      'PathExists= is level-triggered: a request cleared at the end re-triggers forever on any '
      + 'failure before that line, and the loop is permanent',
    );
  });

  it('keeps the claimed request instead of deleting it', () => {
    assert.ok(
      !/rm -f "\$\{REQUEST\}"/.test(RUNNER),
      'SIGKILL cannot be caught, so a run that reports nothing leaves the moved file as the only '
      + 'evidence of what was asked for',
    );
  });

  it('reports "running" before it starts, with no end timestamp', () => {
    assert.ok(
      at('write_status null') < at('git ls-remote'),
      'a status written only at the end says nothing about a run that was killed',
    );
    assert.ok(
      at('state="running"') < at('write_status null'),
      'the up-front record is what separates "killed" from "never started"',
    );
  });

  it('turns the signals systemd sends into an exit that reports', () => {
    for (const sig of ['TERM', 'INT', 'HUP']) {
      assert.ok(
        new RegExp(`trap '[^']*' ${sig}`).test(RUNNER),
        `an untrapped SIG${sig} kills the shell without running the EXIT trap, and the start `
        + 'timeout arrives as SIGTERM in the middle of the sequence',
      );
    }
  });

  it('writes no status when there was no request to claim', () => {
    const skip = RUNNER.slice(at('! -f ${REQUEST}'), at('mv -f "${REQUEST}"'));
    assert.ok(
      /trap - EXIT/.test(skip),
      'a spurious trigger would otherwise replace the previous outcome with "nothing to do", '
      + 'erasing the record someone is about to look for',
    );
  });

  it('resolves the tag against a literal URL, never the checkout\'s origin', () => {
    const [, url] = RUNNER.match(/^REPO_URL="(https:\/\/\S+)"/m);
    assert.ok(url.startsWith('https://'), 'the source of the code must not be configurable by shellmer');
    assert.ok(
      /git ls-remote --tags "\$\{REPO_URL\}"/.test(RUNNER),
      'resolving through `origin` lets the least privileged half choose where the code comes from',
    );
  });

  it('checks out a commit id, not a name', () => {
    assert.ok(
      /SHELLM_REF="\$\{resolved_sha\}"/.test(RUNNER),
      'shellmer can point a local tag of the right name at any commit, including between the '
      + 'fetch and the checkout; a commit id cannot be hijacked',
    );
    assert.ok(/\^\{\}/.test(RUNNER), 'annotated tags need the peeled lookup');
    assert.ok(
      RUNNER.match(/git ls-remote/g).length >= 2,
      'lightweight tags return nothing for the peeled refspec and need the unpeeled fallback',
    );
  });

  it('leaves the snapshot to the CLI rather than taking its own', () => {
    assert.ok(
      !/sqlite3|\.backup/.test(RUNNER),
      'a second implementation of the snapshot diverges from the first, which is the reason '
      + 'ADR-0003 refused to reimplement the update sequence here — see ADR-0004',
    );
    assert.ok(
      !/\bcp\b.*shellm\.db/.test(RUNNER),
      'WAL mode makes a copied .db file torn or stale',
    );
    const update = readFileSync(path.join(root, 'src/cli/update.js'), 'utf8');
    assert.ok(
      update.indexOf('backup') < update.indexOf("step('Running migrations')"),
      'the update takes the snapshot before the migrations it cannot undo',
    );
  });

  it('reports on every exit, including the failures', () => {
    assert.ok(/trap on_exit EXIT/.test(RUNNER), 'a button that says nothing when it fails is worse than none');
    assert.ok(
      /install -m 0640 -o "\$\{SERVICE_USER\}" -g "\$\{SERVICE_USER\}"/.test(RUNNER),
      'root writes the status and the confined service reads it',
    );
  });
});

// `sudo shellm update` is the documented upgrade path, so it has to be able to deliver the wiring
// of a feature it is itself shipping. If these two lists drift, a host that upgrades gets new code
// and an old unit — and the symptom, a button that does nothing, is the same symptom as the
// expected opt-in state.
describe('the two installers agree on what lives outside the checkout', () => {
  const { SYSTEM_FILES } = require('../../src/cli/update');

  // Every destination vps.sh writes to under /etc or /usr, whichever command it used.
  function destinationsInVps() {
    const found = new Set();
    for (const [, dest] of VPS.matchAll(/\s(\/(?:etc|usr)\/[\w./-]+)/g)) found.add(dest);
    return found;
  }

  it('installs every system file an update would replace', () => {
    const vps = destinationsInVps();
    for (const { dest } of SYSTEM_FILES) {
      assert.ok(vps.has(dest), `shellm update replaces ${dest}, but vps.sh never installs it`);
    }
  });

  it('replaces on update every system file vps.sh installs', () => {
    const managed = new Set(SYSTEM_FILES.map((f) => f.dest));
    for (const dest of destinationsInVps()) {
      assert.ok(
        managed.has(dest),
        `vps.sh installs ${dest} and shellm update never replaces it — a host that upgrades the `
        + 'documented way keeps the old one',
      );
    }
  });

  it('applies a new tmpfiles entry during the update rather than at the next boot', () => {
    const source = readFileSync(path.join(root, 'src/cli/update.js'), 'utf8');
    assert.ok(
      /systemd-tmpfiles --create/.test(source),
      'the directory has to exist before the restart, which is what rebuilds the mount namespace',
    );
    assert.ok(
      source.indexOf('systemd-tmpfiles --create') < source.indexOf("execAsRoot('systemctl restart shellm')"),
      'creating it after the restart leaves the service unable to write there until the next one',
    );
  });
});

describe('vps.sh installs the trigger without arming it', () => {
  it('never enables the path unit for the operator', () => {
    const enables = VPS.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^systemctl\s+enable\b/.test(l));
    assert.ok(
      !enables.some((l) => l.includes('shellm-update')),
      'enabling the trigger arms a root unit; that is the operator\'s decision, not the script\'s',
    );
  });

  it('restarts the service after creating the runtime directory for the first time', () => {
    const created = VPS.indexOf('systemd-tmpfiles --create');
    assert.notEqual(created, -1, 'the directory has to exist before the service builds its namespace');
    const restart = VPS.indexOf('systemctl restart shellm', created);
    assert.notEqual(
      restart,
      -1,
      'ReadWritePaths= skips a path that does not exist, and the namespace is built at start — '
      + 'a service already running when /run/shellm appears still cannot write there',
    );
    assert.ok(
      VPS.slice(created, restart).includes('is-active --quiet shellm'),
      'the restart must be guarded, or provisioning a stopped host starts it as a side effect',
    );
  });
});
