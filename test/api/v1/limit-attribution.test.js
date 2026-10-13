const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const FIXTURES = path.resolve(__dirname, '../../fixtures/codex/0.154.0');

// The usage-limit banner reads the request log: a provider's 429 must be logged against that
// provider, and the gateway's own 429 (full queue) must not be.
describe('who a failed request is logged against', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let modeFile;
  let request;
  let app;
  let db;
  let stats;
  let testKey;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../../src/providers/base')], 'base.js already captured the real PATH');
    process.env.SHELLM_GLOBAL_RPM = '200';
    process.env.MAX_CONCURRENT = '1';
    process.env.MAX_QUEUE_DEPTH = '1';
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    modeFile = path.join(fakeBin, 'mode');
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!${process.execPath}
const fs = require('fs');
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
const file = mode === 'limit' ? 'exec-json-usage-limit.constructed.jsonl' : 'exec-json.jsonl';
setTimeout(() => process.stdout.write(fs.readFileSync(${JSON.stringify(FIXTURES)} + '/' + file, 'utf8')), mode === 'slow' ? 300 : 0);
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
    delete process.env.MAX_CONCURRENT;
    delete process.env.MAX_QUEUE_DEPTH;
    db.closeDb();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  beforeEach(() => db.getDb().prepare('DELETE FROM request_logs').run());

  const send = (url) => {
    const messages = [{ role: 'user', content: 'x' }];
    const body = url === '/v1/messages' ? { model: 'codex', max_tokens: 10, messages } : { model: 'codex', messages };
    return request(app).post(url).set('Authorization', `Bearer ${testKey}`).send(body);
  };

  async function loggedRows(count) {
    const read = () => db.getDb().prepare('SELECT status, provider FROM request_logs ORDER BY id').all();
    for (let i = 0; i < 50 && read().length < count; i++) await sleep(10);
    return read();
  }

  for (const url of ['/v1/chat/completions', '/v1/messages']) {
    it(`logs a provider usage limit against the provider on ${url}`, async () => {
      fs.writeFileSync(modeFile, 'limit');

      const res = await send(url);

      assert.equal(res.status, 429);
      assert.deepEqual(await loggedRows(1), [{ status: 429, provider: 'codex' }]);
      assert.equal(stats.limitState('-1 hours')?.provider, 'codex');
    });
  }

  it('logs a full queue against no provider, so it never reads as a usage limit', async () => {
    fs.writeFileSync(modeFile, 'slow');

    const later = (ms) => sleep(ms).then(() => send('/v1/chat/completions'));
    const [running, waiting, refused] = await Promise.all([send('/v1/chat/completions'), later(30), later(60)]);

    assert.deepEqual([running.status, waiting.status, refused.status], [200, 200, 429]);
    const rows = await loggedRows(3);
    assert.deepEqual(rows.find((r) => r.status === 429), { status: 429, provider: null });
    assert.equal(stats.limitState('-1 hours'), null);
  });
});
