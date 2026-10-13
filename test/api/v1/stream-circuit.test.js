const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROMPT_TOO_LONG = path.resolve(__dirname, '../../fixtures/claude/2.1.273/result-prompt-too-long.json');

// Streams answer through the circuit breaker the same way a plain request does: a finished
// stream closes a recovering circuit, a provider failure counts, a caller's mistake does not.
describe('streamed requests and the circuit breaker', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let modeFile;
  let request;
  let app;
  let cb;
  let testKey;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../../src/providers/base')], 'base.js already captured the real PATH');
    process.env.CIRCUIT_BREAKER_THRESHOLD = '1';
    process.env.CIRCUIT_BREAKER_RESET_MS = '0';
    process.env.SHELLM_GLOBAL_RPM = '200';
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    modeFile = path.join(fakeBin, 'mode');
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!${process.execPath}
const fs = require('fs');
fs.readFileSync(0);
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
if (mode === 'crash') { process.stderr.write('boom'); process.exit(2); }
if (mode === 'too-long') { process.stdout.write(fs.readFileSync(${JSON.stringify(PROMPT_TOO_LONG)}, 'utf8')); process.exit(1); }
console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }));
console.log(JSON.stringify({ type: 'result', result: 'hi', usage: { input_tokens: 1, output_tokens: 1 } }));
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;

    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');
    testKey = createClient({ name: 'test-client', rpm: 100 }).rawKey;

    request = require('supertest');
    app = require('../../../src/app');
    cb = require('../../../src/infra/circuit-breaker');
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.CIRCUIT_BREAKER_THRESHOLD;
    delete process.env.CIRCUIT_BREAKER_RESET_MS;
    require('../../../src/db').closeDb();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  beforeEach(() => cb.resetCircuit('claude'));

  const stream = (format, mode) => {
    fs.writeFileSync(modeFile, mode);
    const messages = [{ role: 'user', content: 'x' }];
    const [url, body] = format === 'openai'
      ? ['/v1/chat/completions', { model: 'claude', stream: true, messages }]
      : ['/v1/messages', { model: 'claude', max_tokens: 10, stream: true, messages }];
    return request(app).post(url).set('Authorization', `Bearer ${testKey}`).send(body);
  };

  for (const format of ['openai', 'anthropic']) {
    describe(`${format} format`, () => {
      it('closes a recovering circuit when the probe stream finishes', async () => {
        cb.recordFailure('claude');

        const res = await stream(format, 'ok');

        assert.equal(res.status, 200);
        assert.equal(cb.getCircuitState('claude').state, 'closed');
      });

      it('counts a provider failure', async () => {
        await stream(format, 'crash');

        assert.equal(cb.getCircuitState('claude').state, 'open');
      });

      it('does not count a client error, and gives a probe slot back', async () => {
        const closed = await stream(format, 'too-long');
        assert.match(closed.text, /context_length_exceeded|prompt is too long/i);
        assert.equal(cb.getCircuitState('claude').state, 'closed');

        cb.recordFailure('claude');
        await stream(format, 'too-long');
        assert.equal(cb.getCircuitState('claude').state, 'half_open');
        assert.equal(cb.canSendTraffic('claude'), true);
      });
    });
  }
});
