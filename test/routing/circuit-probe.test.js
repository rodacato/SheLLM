const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROMPT_TOO_LONG = path.resolve(__dirname, '../fixtures/claude/2.1.273/result-prompt-too-long.json');

// A circuit that is due for a retry hands out one probe slot. Every way a probe can end has to
// give it back, or the provider answers 503 circuit_open until the service restarts.
describe('circuit breaker probe slot', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let modeFile;
  let cb;
  let route;
  let getAvailableProviders;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    process.env.CIRCUIT_BREAKER_THRESHOLD = '1';
    process.env.CIRCUIT_BREAKER_RESET_MS = '0';
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    modeFile = path.join(fakeBin, 'mode');
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
fs.readFileSync(0);
if (fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8') === 'crash') { process.stderr.write('boom'); process.exit(2); }
process.stdout.write(fs.readFileSync(${JSON.stringify(PROMPT_TOO_LONG)}, 'utf8'));
process.exit(1);
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    cb = require('../../src/infra/circuit-breaker');
    ({ route, getAvailableProviders } = require('../../src/routing'));
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.CIRCUIT_BREAKER_THRESHOLD;
    delete process.env.CIRCUIT_BREAKER_RESET_MS;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  beforeEach(() => {
    cb.resetCircuit('claude');
    cb.resetCircuit('codex');
    fs.writeFileSync(modeFile, 'too-long');
  });

  it('is not taken by listing the available providers', () => {
    cb.recordFailure('codex');

    assert.ok(getAvailableProviders().includes('codex'));
    assert.equal(cb.canSendTraffic('codex'), true);
  });

  it('is given back when the probe ends in a client error', async () => {
    cb.recordFailure('claude');

    await assert.rejects(route({ model: 'claude', prompt: 'x', allowFallback: false }), (err) => err.status === 400);

    assert.equal(cb.getCircuitState('claude').state, 'half_open');
    assert.equal(cb.canSendTraffic('claude'), true);
  });

  it('is given back on the fallback path too', async () => {
    cb.recordFailure('claude');

    await assert.rejects(route({ model: 'claude', prompt: 'x', allowFallback: true }), (err) => err.status === 400);

    assert.equal(cb.canSendTraffic('claude'), true);
  });

  it('still reopens the circuit when the probe fails on the provider side', async () => {
    cb.recordFailure('claude');
    fs.writeFileSync(modeFile, 'crash');

    await assert.rejects(route({ model: 'claude', prompt: 'x', allowFallback: false }), { stderr: 'boom' });

    assert.equal(cb.getCircuitState('claude').state, 'open');
  });
});
