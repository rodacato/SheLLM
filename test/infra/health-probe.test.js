const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The probe used to be a real model call, and any failure it could not classify was reported as
// a logout — which refused every request to that provider with 503 until the next poll.
describe('health probes', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let ledger;
  let health;
  let codex;
  let providerSelect;

  function argvOf(cli) {
    return JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.argv.json`), 'utf8'));
  }

  function writeCli(cli, body) {
    fs.writeFileSync(path.join(fakeBin, cli), `#!${process.execPath}\nconst fs = require('fs');\n${body}\n`, { mode: 0o755 });
  }

  function recordArgv(cli) {
    return `fs.writeFileSync(${JSON.stringify(path.join(fakeBin, `${cli}.argv.json`))}, JSON.stringify(process.argv.slice(2)));`;
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-probe-'));
    ledger = path.join(fakeBin, 'ledger.txt');
    fs.writeFileSync(ledger, '');

    writeCli('claude', `${recordArgv('claude')}
process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }));`);

    // Answers the probe, and on a real run holds the process open long enough to overlap.
    writeCli('codex', `${recordArgv('codex')}
const args = process.argv.slice(2);
if (args[0] === 'login') { process.stdout.write('Logged in using ChatGPT'); return; }
fs.appendFileSync(${JSON.stringify(ledger)}, 'start\\n');
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'OK' } }) + '\\n');
  fs.appendFileSync(${JSON.stringify(ledger)}, 'end\\n');
}, 150);`);

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    health = require('../../src/infra/health');
    codex = require('../../src/providers/codex');
    providerSelect = require('../../src/routing/provider-select');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('probes with a free auth command instead of a model call', async () => {
    await health.checkProvider({ name: 'claude', type: 'subprocess' });
    await health.checkProvider({ name: 'codex', type: 'subprocess' });

    assert.deepStrictEqual(argvOf('claude'), ['auth', 'status']);
    assert.deepStrictEqual(argvOf('codex'), ['login', 'status']);
    for (const cli of ['claude', 'codex']) {
      const sent = argvOf(cli).join(' ');
      assert.ok(!sent.includes('--print') && !sent.includes('exec'), `${cli} probe sends a prompt: ${sent}`);
    }
    assert.equal(fs.readFileSync(ledger, 'utf8'), '', 'the codex probe never started a turn');
  });

  it('an unrecognised failure is unknown, not a logout, so traffic still flows', async () => {
    writeCli('codex', `${recordArgv('codex')}
process.stderr.write("ERROR: The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.\\n");
process.exit(1);`);

    const result = await health.checkProvider({ name: 'codex', type: 'subprocess' });
    assert.strictEqual(result.authenticated, null, 'a model problem is not an auth problem');
    assert.match(result.error, /not supported/);

    await health.getHealthStatus();
    const reason = providerSelect.checkProviderAvailability(codex);
    assert.notStrictEqual(reason, 'not authenticated', 'this verdict is what refused every codex request with 503');
  });

  it('takes the provider\'s lock, so a probe never overlaps a request', async () => {
    writeCli('codex', `${recordArgv('codex')}
const args = process.argv.slice(2);
if (args[0] === 'login') { process.stdout.write('Logged in using ChatGPT'); return; }
fs.appendFileSync(${JSON.stringify(ledger)}, 'start\\n');
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'OK' } }) + '\\n');
  fs.appendFileSync(${JSON.stringify(ledger)}, 'end\\n');
}, 150);`);
    fs.writeFileSync(ledger, '');

    await Promise.all([
      codex.chat({ prompt: 'ping', model: 'codex' }),
      codex.withLock(() => new Promise((resolve) => {
        fs.appendFileSync(ledger, 'start\n');
        setTimeout(() => { fs.appendFileSync(ledger, 'end\n'); resolve(); }, 150);
      })),
    ]);

    let running = 0;
    for (const entry of fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)) {
      running += entry === 'start' ? 1 : -1;
      assert.ok(running <= 1, 'a probe ran beside a request');
    }
  });
});
