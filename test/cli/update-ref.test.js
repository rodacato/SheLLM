'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isSupportedRef } = require('../../src/cli/update');

const SOURCE_ROOT = path.resolve(__dirname, '../..');

let workspace;
let app;
let sentinel;

// A throwaway checkout with its own origin, so `shellm update` runs against a real repository and
// a real remote without the network and without touching this one. Only the CLI is copied in:
// resolving a ref needs nothing else, and the update stops before it would.
function buildCheckout() {
  const origin = path.join(workspace, 'origin.git');
  app = path.join(workspace, 'app');

  git(workspace, 'init', '--bare', '--initial-branch=master', origin);
  git(workspace, 'init', '--initial-branch=master', app);
  git(app, 'config', 'user.email', 'test@example.com');
  git(app, 'config', 'user.name', 'test');

  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_ROOT, 'src/cli.js'), path.join(app, 'src/cli.js'));
  fs.cpSync(path.join(SOURCE_ROOT, 'src/cli'), path.join(app, 'src/cli'), { recursive: true });

  git(app, 'add', '-A');
  git(app, 'commit', '-m', 'initial');
  git(app, 'remote', 'add', 'origin', origin);
  git(app, 'push', 'origin', 'master');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function head() {
  return git(app, 'rev-parse', 'HEAD').trim();
}

// `git fetch` writes .git/FETCH_HEAD. Its absence is what says no git command ran at all, which is
// the claim a hostile ref has to satisfy — not merely that the checkout survived.
function fetched() {
  return fs.existsSync(path.join(app, '.git', 'FETCH_HEAD'));
}

function update(ref) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(app, 'src/cli.js'), 'update'], {
      cwd: workspace,
      env: { PATH: process.env.PATH, HOME: workspace, NO_COLOR: '1', SHELLM_REF: ref },
      timeout: 60000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

describe('shellm update — SHELLM_REF', () => {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-update-ref-'));
    sentinel = path.join(workspace, 'pwned');
    buildCheckout();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('accepts the three documented forms', () => {
    for (const ref of ['v1.0.0', 'v12.4.31', 'a'.repeat(40), '0f2a1c9b3d4e5f60718293a4b5c6d7e8f9012345', 'master', 'main', 'fix/resolve-ref', 'release-2.x']) {
      assert.ok(isSupportedRef(ref), `expected ${ref} to be accepted`);
    }
  });

  it('rejects anything a shell could read as more than a ref', () => {
    const hostile = [
      "v1.0.0'; touch /tmp/pwned; '",
      'v1.0.0; rm -rf /',
      'v1.0.0 && whoami',
      'v1.0.0`id`',
      'v1.0.0$(id)',
      'v1.0.0|tee /tmp/x',
      'v1.0.0\nmaster',
      '$(curl http://example.com)',
      '--upload-pack=touch /tmp/pwned',
      '-x',
      'origin/../../etc/passwd',
      'a'.repeat(129),
      '',
    ];
    for (const ref of hostile) {
      assert.equal(isSupportedRef(ref), false, `expected ${JSON.stringify(ref)} to be rejected`);
    }
  });

  // AC4: the four metacharacter families, each through the real CLI against a real checkout.
  for (const [name, payload] of [
    ['a quote', (s) => `v1.0.0'; touch ${s}; '`],
    ['a semicolon', (s) => `v1.0.0; touch ${s}`],
    ['a backtick', (s) => `v1.0.0\`touch ${s}\``],
    ['a command substitution', (s) => `v1.0.0$(touch ${s})`],
  ]) {
    it(`runs nothing and moves nothing when the ref contains ${name}`, async () => {
      const before = head();
      const res = await update(payload(sentinel));

      assert.equal(res.code, 1);
      assert.match(res.stderr, /SHELLM_REF is not a release tag/);
      assert.equal(fs.existsSync(sentinel), false, 'the payload executed');
      assert.equal(fetched(), false, 'a git command ran before the ref was checked');
      assert.equal(head(), before);
      assert.equal(git(app, 'status', '--porcelain').trim(), '');
    });
  }

  // AC2: well-formed, fetched, and still not a ref this checkout has.
  it('aborts without checking out when a well-formed ref does not exist', async () => {
    const before = head();
    const res = await update('v999.999.999');

    assert.equal(res.code, 1);
    assert.match(res.stderr, /v999\.999\.999 is not a ref this checkout knows about/);
    assert.ok(fetched(), 'expected the fetch to have run before the ref was resolved');
    assert.equal(head(), before);
  });
});
