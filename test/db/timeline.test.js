'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { initDb, closeDb, getDb, insertRequestLog } = require('../../src/db');
const stats = require('../../src/db/stats');

const HOUR_MS = 3600000;
const WINDOW = '-30 days';

// Three requests six hours apart, so the hours between them are genuinely empty rather than
// absent for want of data. Backdating is done in SQL because created_at defaults to now.
function seedAt(requestId, hoursAgo, status) {
  insertRequestLog({ request_id: requestId, provider: 'claude', model: 'claude', status, duration_ms: 100 });
  getDb().prepare(
    "UPDATE request_logs SET created_at = datetime('now', ?) WHERE request_id = ?",
  ).run(`-${hoursAgo} hours`, requestId);
}

describe('the timeline reports the hours nothing happened in', () => {
  let rows;

  before(() => {
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');
    seedAt('t-first', 12, 200);
    seedAt('t-middle', 6, 500);
    seedAt('t-last', 0, 200);
    rows = stats.timeline(WINDOW);
  });

  after(() => closeDb());

  it('emits one row per hour, with no hour missing', () => {
    assert.ok(rows.length >= 12, `expected the quiet hours to be present, got ${rows.length} rows`);

    const stamps = rows.map((r) => Date.parse(r.bucket_at));
    for (let i = 1; i < stamps.length; i++) {
      assert.strictEqual(stamps[i] - stamps[i - 1], HOUR_MS,
        `hours ${i - 1} and ${i} are not adjacent — a quiet hour was dropped, and the chart would draw it as no time at all`);
    }
  });

  it('reports a quiet hour as zero, not as a missing point', () => {
    const quiet = rows.filter((r) => r.requests === 0);
    assert.ok(quiet.length >= 8, `expected the empty hours between the three requests, got ${quiet.length}`);
    for (const row of quiet) {
      assert.strictEqual(row.errors, 0);
      assert.strictEqual(row.cost, 0);
      assert.ok(Number.isFinite(Date.parse(row.bucket_at)));
    }
  });

  it('keeps the hours that did happen, with what happened in them', () => {
    const busy = rows.filter((r) => r.requests > 0);
    assert.strictEqual(busy.length, 3, 'one hour per seeded request');
    assert.strictEqual(busy.reduce((n, r) => n + r.errors, 0), 1, 'the 500 is the only error');
  });

  it('runs to the hour asked for, so the line reaches the present', () => {
    const now = Date.now();
    const last = Date.parse(rows[rows.length - 1].bucket_at);
    assert.ok(now - last < HOUR_MS, 'the last bucket is the current hour');
  });

  it('says nothing rather than inventing a range when there is no traffic', () => {
    getDb().prepare('DELETE FROM request_logs').run();
    assert.deepStrictEqual(stats.timeline(WINDOW), []);
  });
});
