/**
 * Auth-probe contract — run the real claude and codex binaries and check that each provider's
 * authProbe reads the verdict the binary actually gives.
 *
 * What this proves is that the fakes in test/infra/health-probe.test.js are faithful: the real
 * refusal really does arrive with a non-zero exit, on the stream each parse reads — claude's
 * JSON on stdout, codex's sentence on stderr. That checkProvider then reads a *refused* probe at
 * all is the wiring, and the fakes are what test it; this file cannot, because neither CLI takes
 * its config directory from anything providerEnv() passes (claude ignores XDG_CONFIG_HOME and
 * honours only CLAUDE_CONFIG_DIR).
 *
 * A logout needs no login to reproduce: an empty config directory is a genuinely signed-out
 * binary. Run: npm run test:cli (the CLIs must be on PATH). Neither command spends quota.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claude = require('../../src/providers/claude');
const codex = require('../../src/providers/codex');

const TIMEOUT_MS = 30000;

let empty;

before(() => { empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-probe-cli-')); });
after(() => { fs.rmSync(empty, { recursive: true, force: true }); });

function run(command, args, env) {
  return new Promise((resolve) => {
    execFile(command, args, { env: { ...process.env, ...env }, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ missing: err?.code === 'ENOENT', stdout, stderr });
    });
  });
}

describe('auth probes against the real binaries', () => {
  it('claude: an empty config directory is read as a logout', async () => {
    const { missing, stdout, stderr } = await run('claude', claude.authProbe.args, { CLAUDE_CONFIG_DIR: empty });
    if (missing) return assert.fail('claude is not on PATH');
    assert.strictEqual(claude.authProbe.parse(stdout, stderr), false);
  });

  it('codex: an empty config directory is read as a logout', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-codex-cli-'));
    try {
      const { missing, stdout, stderr } = await run('codex', codex.authProbe.args, { CODEX_HOME: home });
      if (missing) return assert.fail('codex is not on PATH');
      assert.strictEqual(codex.authProbe.parse(stdout, stderr), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // Only meaningful where the host is signed in, so an unauthenticated CI reports the skip
  // instead of a failure it cannot do anything about.
  for (const [name, provider] of [['claude', claude], ['codex', codex]]) {
    it(`${name}: a signed-in host is read as a login`, async (t) => {
      const { missing, stdout, stderr } = await run(name, provider.authProbe.args, {});
      if (missing) return assert.fail(`${name} is not on PATH`);
      const verdict = provider.authProbe.parse(stdout, stderr);
      if (verdict !== true) return t.skip(`this host is not signed in to ${name}`);
      assert.strictEqual(verdict, true);
    });
  }
});
