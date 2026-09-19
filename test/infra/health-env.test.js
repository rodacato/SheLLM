const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'oathealthprobetokenvalue0123456789abcdef';

describe('health probes and provider credentials', () => {
  const originalPath = process.env.PATH;
  const originalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let fakeBin;
  let health;

  function envDump(cli) {
    return JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.env.json`), 'utf8'));
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');

    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-health-'));
    // Stands in for a CLI logged in by token: without it, the real binary answers 401.
    for (const cli of ['claude', 'codex']) {
      fs.writeFileSync(path.join(fakeBin, cli), `#!${process.execPath}
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(path.join(fakeBin, 'CLI.env.json'))}.replace('CLI', '${cli}'), JSON.stringify(process.env));
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN || fs.existsSync(${JSON.stringify(path.join(fakeBin, 'REVOKED'))})) {
  process.stderr.write('Failed to authenticate. API Error: 401 Invalid bearer token ' + (process.env.CLAUDE_CODE_OAUTH_TOKEN || 'none') + '\\n');
  process.exit(1);
}
process.stdout.write('ok');
`, { mode: 0o755 });
    }

    process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    health = require('../../src/infra/health');
  });

  after(() => {
    process.env.PATH = originalPath;
    if (originalToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalToken;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('gives the probe the same environment the provider uses', async () => {
    await health.checkProvider({ name: 'claude', type: 'subprocess' });
    assert.strictEqual(envDump('claude').CLAUDE_CODE_OAUTH_TOKEN, TOKEN);

    await health.checkProvider({ name: 'codex', type: 'subprocess' });
    assert.ok(!('CLAUDE_CODE_OAUTH_TOKEN' in envDump('codex')), 'codex must not receive claude credentials');
    assert.ok('XDG_CONFIG_HOME' in envDump('codex') || Object.keys(envDump('codex')).length > 0);
  });

  it('reports a token-authenticated provider as authenticated', async () => {
    const deep = await health.checkProvider(
      { name: 'claude', type: 'subprocess', health_check: { command: 'claude', args: ['--print', '--', 'test'] } },
      { deep: true },
    );
    assert.deepStrictEqual(deep, { installed: true, authenticated: true });

    const shallow = await health.checkProvider({ name: 'claude', type: 'subprocess' });
    assert.strictEqual(shallow.authenticated, true);
  });

  it('reports a revoked token as unauthenticated without echoing it back', async () => {
    fs.writeFileSync(path.join(fakeBin, 'REVOKED'), '');
    try {
      const result = await health.checkProvider(
        { name: 'claude', type: 'subprocess', health_check: { command: 'claude', args: ['--print', '--', 'test'] } },
        { deep: true },
      );
      assert.strictEqual(result.authenticated, false);
      assert.ok(!JSON.stringify(result).includes(TOKEN), 'the token reached health_error');
      assert.match(result.error, /REDACTED/);
    } finally {
      fs.rmSync(path.join(fakeBin, 'REVOKED'));
    }
  });
});
