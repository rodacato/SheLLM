const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const FIXTURES = path.resolve(__dirname, '../../fixtures/codex/0.154.0');

// Codex reports tokens and no cost. Its requests carry an estimate at API list price, beside
// cost_usd and never inside it (ADR-0012). The fixture's turn used 12,683 input tokens, 10,624
// of them cached, and 5 output tokens.
describe('an estimated cost for a request the CLI did not price', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let request;
  let app;
  let db;
  let stats;
  let testKey;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../../src/providers/base')], 'base.js already captured the real PATH');
    process.env.SHELLM_GLOBAL_RPM = '200';
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!${process.execPath}
process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(FIXTURES, 'exec-json.jsonl'))}, 'utf8'));
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;

    db = require('../../../src/db');
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
    testKey = db.createClient({ name: 'test-client', rpm: 100 }).rawKey;
    request = require('supertest');
    app = require('../../../src/app');
    stats = require('../../../src/db/stats');
  });

  after(() => {
    process.env.PATH = originalPath;
    db.closeDb();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  beforeEach(() => db.getDb().prepare('DELETE FROM request_logs').run());

  const send = (url, model, extra = {}) => {
    const messages = [{ role: 'user', content: 'x' }];
    const body = url === '/v1/messages' ? { model, max_tokens: 10, messages, ...extra } : { model, messages, ...extra };
    return request(app).post(url).set('Authorization', `Bearer ${testKey}`).send(body);
  };

  async function loggedRow() {
    const read = () => db.getDb().prepare('SELECT upstream_model, cost_usd, cost_estimate_usd FROM request_logs').get();
    for (let i = 0; i < 50 && !read(); i++) await sleep(10);
    return read();
  }

  // (2,059 fresh × $4 + 10,624 cached × $0.40 + 5 out × $20) / 1M at gpt-5.6-sol's listed rates.
  const SOL = 0.012586;

  for (const url of ['/v1/chat/completions', '/v1/messages']) {
    it(`estimates a buffered codex request on ${url}, and logs the model that ran`, async () => {
      const res = await send(url, 'codex-gpt-5.6-sol');

      assert.equal(res.status, 200);
      assert.equal(res.body.x_shellm.cost_usd, null);
      assert.equal(res.body.x_shellm.cost_estimate_usd, SOL);
      assert.deepEqual(await loggedRow(), { upstream_model: 'gpt-5.6-sol', cost_usd: null, cost_estimate_usd: SOL });
    });
  }

  it('estimates a streamed codex request too', async () => {
    const res = await send('/v1/chat/completions', 'codex-gpt-5.6-sol', { stream: true });

    assert.match(res.text, /"cost_estimate_usd":0\.012586/);
    assert.equal((await loggedRow()).cost_estimate_usd, SOL);
  });

  it('prices a bare "codex" at the model the CLI ran, not at the alias', async () => {
    await send('/v1/chat/completions', 'codex');

    const row = await loggedRow();
    assert.notEqual(row.upstream_model, 'codex');
    assert.ok(row.cost_estimate_usd > 0, JSON.stringify(row));
  });

  it('keeps estimates apart from reported cost in every total', async () => {
    await send('/v1/chat/completions', 'codex-gpt-5.6-sol');
    await loggedRow();

    const [codex] = stats.usageByProvider('-1 hours');
    assert.equal(codex.priced_requests, 0);
    assert.equal(codex.cost_usd, 0);
    assert.equal(codex.estimated_requests, 1);
    assert.equal(codex.cost_estimate_usd, 0.0126);
  });

  it('gives no estimate for a model the price list does not name', async () => {
    const res = await send('/v1/chat/completions', 'codex-gpt-unlisted');

    assert.equal(res.body.x_shellm.cost_estimate_usd, null);
    assert.equal((await loggedRow()).cost_estimate_usd, null);
  });
});
