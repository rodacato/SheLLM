'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { initDb, closeDb, getDb, insertRequestLog } = require('../../src/db');
const stats = require('../../src/db/stats');

const WEEK_HOURS = 168;
const UPTIME_HOURS = 18;

function seedAt(requestId, hoursAgo, costUsd) {
  insertRequestLog({ request_id: requestId, provider: 'claude', model: 'claude', status: 200, duration_ms: 100, cost_usd: costUsd });
  getDb().prepare(
    "UPDATE request_logs SET created_at = datetime('now', ?) WHERE request_id = ?",
  ).run(`-${hoursAgo} hours`, requestId);
}

function freshDb() {
  try { closeDb(); } catch { /* not open */ }
  initDb(':memory:');
}

describe('a usage window divides by the time that elapsed', () => {
  describe('when the gateway is younger than the window', () => {
    let week;

    before(() => {
      freshDb();
      seedAt('u-first', UPTIME_HOURS, 2);
      seedAt('u-last', 0, 2);
      week = stats.usageWindow(WEEK_HOURS, UPTIME_HOURS);
    });

    after(() => closeDb());

    it('covers far less than it asked for — otherwise the assertions below prove nothing', () => {
      assert.ok(week.observed_hours < WEEK_HOURS / 5,
        `the fixture must span a small fraction of the window, spans ${week.observed_hours}h`);
      assert.strictEqual(week.requests, 2);
      assert.strictEqual(week.cost_usd, 4);
    });

    it('reports the span it actually covers alongside the one it was asked for', () => {
      assert.strictEqual(week.observed_hours, UPTIME_HOURS);
      assert.strictEqual(week.hours, WEEK_HOURS);
    });

    it('divides cost by the observed span', () => {
      assert.strictEqual(week.cost_per_hour, Math.round((4 / UPTIME_HOURS) * 10000) / 10000);
    });

    it('divides requests by the observed span too', () => {
      assert.strictEqual(week.requests_per_minute, Math.round((2 / (UPTIME_HOURS * 60)) * 100) / 100);
    });

    // The bug this file exists for: 150 hours the gateway did not exist for, counted as quiet.
    it('does not divide by the hours that never happened', () => {
      const nominal = Math.round((4 / WEEK_HOURS) * 10000) / 10000;
      assert.notStrictEqual(week.cost_per_hour, nominal);
      assert.ok(week.cost_per_hour > nominal * 8,
        `dividing by the nominal window understates the rate: ${week.cost_per_hour} vs ${nominal}`);
    });
  });

  describe('when the gateway is older than the window', () => {
    let short;

    before(() => {
      freshDb();
      seedAt('f-old', 40, 5);
      seedAt('f-new', 0, 5);
      short = stats.usageWindow(5, 40);
    });

    after(() => closeDb());

    it('counts only the rows inside it', () => {
      assert.strictEqual(short.requests, 1, 'the 40h-old row is outside a 5h window');
    });

    it('still divides by the nominal window, because the window is full', () => {
      assert.strictEqual(short.observed_hours, 5);
      assert.strictEqual(short.cost_per_hour, 1);
    });
  });

  // A single recent request used to make the observed span ~0 and the rate explode; the span is
  // the gateway's, not the window's, so one request cannot become a rate of thousands per hour.
  describe('when one request has just arrived', () => {
    let week;

    before(() => {
      freshDb();
      seedAt('s-only', 0, 3);
      week = stats.usageWindow(WEEK_HOURS, UPTIME_HOURS);
    });

    after(() => closeDb());

    it('still divides by how long the gateway has been up', () => {
      assert.strictEqual(week.observed_hours, UPTIME_HOURS);
      assert.strictEqual(week.cost_per_hour, Math.round((3 / UPTIME_HOURS) * 10000) / 10000);
    });
  });

  describe('when there is nothing to measure', () => {
    let empty;

    before(() => {
      freshDb();
      empty = stats.usageWindow(WEEK_HOURS, 0);
    });

    after(() => closeDb());

    it('reports zero rather than dividing by nothing', () => {
      assert.strictEqual(empty.requests, 0);
      assert.strictEqual(empty.observed_hours, 0);
      assert.strictEqual(empty.cost_per_hour, 0);
      assert.strictEqual(empty.requests_per_minute, 0);
    });
  });
});
