'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { breakdown, readRows, quantile, render } = require('../../scripts/latency-breakdown');
const { initDb, closeDb } = require('../../src/db');

let dir;
let db;

// A real SQLite file built by the project's own migrations, so a column renamed in a migration
// breaks this test instead of a hand-written CREATE TABLE that has drifted from the schema.
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-breakdown-'));
  const file = path.join(dir, 'shellm.db');
  initDb(file);
  closeDb();
  db = new Database(file);
});

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function insert(rows) {
  db.prepare('DELETE FROM request_logs').run();
  const stmt = db.prepare(`
    INSERT INTO request_logs (provider, status, streamed, duration_ms, queued_ms, api_ms)
    VALUES (@provider, @status, @streamed, @duration_ms, @queued_ms, @api_ms)
  `);
  for (const row of rows) {
    stmt.run({ provider: 'claude', status: 200, streamed: 0, queued_ms: 0, api_ms: null, ...row });
  }
}

describe('latency-breakdown', () => {
  it('subtracts the queue and the upstream time from the whole request', () => {
    insert([
      { duration_ms: 2500, queued_ms: 100, api_ms: 1500 },
      { duration_ms: 2600, queued_ms: 200, api_ms: 1500 },
      { duration_ms: 3000, queued_ms: 0, api_ms: 2100 },
    ]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.decomposable, 3);
    assert.equal(result.overhead.median, 900, '2600 - 200 - 1500 is the middle of 900/900/900');
    assert.equal(result.overhead.n, 3);
  });

  it('leaves out a row the CLI reported no upstream time for, instead of counting it as zero', () => {
    insert([
      { duration_ms: 2500, queued_ms: 0, api_ms: 1500 },
      { provider: 'codex', duration_ms: 9000, queued_ms: 0, api_ms: null },
    ]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.rows, 2);
    assert.equal(result.decomposable, 1, 'a codex row has nothing to subtract and must not dilute the median');
    assert.equal(result.overhead.median, 1000);
  });

  it('counts the rows whose queue time was never recorded, because they inflate the answer', () => {
    insert([
      { duration_ms: 2500, queued_ms: null, api_ms: 1500, streamed: 1 },
      { duration_ms: 2500, queued_ms: 100, api_ms: 1500 },
    ]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.queueUnrecorded, 1);
    assert.equal(result.queued.n, 1, 'a missing reading is not a zero in the queue row');
    assert.match(render(result, { db: 'x', days: 30 }), /record no queue time/);
  });

  it('reports a negative leftover rather than hiding it in a median', () => {
    insert([
      { duration_ms: 1000, queued_ms: 0, api_ms: 1800 },
      { duration_ms: 2500, queued_ms: 0, api_ms: 1500 },
    ]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.negative, 1);
    assert.match(render(result, { db: 'x', days: 30 }), /came out negative/);
  });

  it('ignores failed requests, which never reached a provider', () => {
    insert([
      { duration_ms: 50, status: 401, api_ms: null },
      { duration_ms: 2500, queued_ms: 0, api_ms: 1500 },
    ]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.rows, 1);
  });

  it('says so plainly when nothing in the window can be split', () => {
    insert([{ provider: 'codex', duration_ms: 9000, api_ms: null }]);
    const result = breakdown(readRows(db, { days: 30, provider: null }));

    assert.equal(result.decomposable, 0);
    assert.match(render(result, { db: 'x', days: 30 }), /none decomposable/);
  });

  it('interpolates a quantile instead of rounding to a neighbour', () => {
    assert.equal(quantile([10, 20], 0.5), 15);
    assert.equal(quantile([], 0.5), null);
  });
});
