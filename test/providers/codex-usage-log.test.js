'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, '../fixtures/codex/0.154.0');

// Constructed, not recorded: 0.154.0 always reports the cache counters. This is the older CLI
// that does not, and the shape the log has to keep distinguishable from a measured zero.
const NO_CACHE_COUNTERS = [
  '{"type":"thread.started","thread_id":"01a0ba02-2e3f-7c21-9576-f8df742155e0"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}',
  '{"type":"turn.completed","usage":{"input_tokens":12683,"output_tokens":5}}',
  '',
].join('\n');

describe('codex token usage reaches the request log', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let codex;
  let requestLogger;
  let getDb;
  let closeDb;

  function logRequest(requestId, result) {
    const req = { method: 'POST', url: '/v1/chat/completions', path: '/v1/chat/completions', requestId, clientName: 'app1' };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.locals = { provider: 'codex', model: 'codex', usage: result.usage, cost_usd: result.cost_usd };
    requestLogger(req, res, () => {});
    res.emit('finish');
    return getDb().prepare('SELECT * FROM request_logs WHERE request_id = ?').get(requestId);
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const model = args[args.indexOf('-m') + 1];
process.stdout.write(model === 'no-cache-counters'
  ? ${JSON.stringify(NO_CACHE_COUNTERS)}
  : fs.readFileSync(${JSON.stringify(path.join(FIXTURES, 'exec-json.jsonl'))}, 'utf8'));
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    codex = require('../../src/providers/codex');
    ({ requestLogger } = require('../../src/middleware/logging'));
    const db = require('../../src/db');
    ({ getDb, closeDb } = db);
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
    closeDb();
  });

  it('persists the cache counters the CLI reported', async () => {
    const result = await codex.chat({ prompt: 'ping', model: 'codex' });
    const row = logRequest('req-cached', result);

    assert.equal(row.cache_read_tokens, 10624, 'the columns were NULL for codex while the CLI reported 84% cached');
    assert.equal(row.cache_write_tokens, 0);
    assert.equal(row.tokens_in, 2059, 'fresh input is what the CLI charged full price for');
    assert.equal(row.tokens, 12688, 'the CLI\'s own total: 12683 input + 5 output, counted once');
  });

  it('leaves the cache columns NULL when the CLI reports no cache counters', async () => {
    const result = await codex.chat({ prompt: 'ping', model: 'codex-no-cache-counters' });
    const row = logRequest('req-no-counters', result);

    assert.equal(row.cache_read_tokens, null, 'a CLI that says nothing about cache must not read as zero cached');
    assert.equal(row.cache_write_tokens, null);
    assert.equal(row.tokens_in, 12683, 'with nothing to subtract, input stays as reported');
    assert.equal(row.tokens, 12688);
  });
});
