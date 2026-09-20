'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TIMEZONE, getTimezone, toInstant } = require('../../src/lib/time');

describe('lib/time', () => {
  afterEach(() => { delete process.env.SHELLM_TZ; });

  it('defaults to Mexico City when nothing is configured', () => {
    delete process.env.SHELLM_TZ;
    assert.strictEqual(getTimezone(), 'America/Mexico_City');
    assert.strictEqual(DEFAULT_TIMEZONE, 'America/Mexico_City');
  });

  it('honours a configured zone', () => {
    process.env.SHELLM_TZ = 'Europe/Helsinki';
    assert.strictEqual(getTimezone(), 'Europe/Helsinki');
  });

  it('falls back instead of throwing on a zone that does not exist', () => {
    process.env.SHELLM_TZ = 'Mars/Olympus_Mons';
    assert.strictEqual(getTimezone(), 'America/Mexico_City');
  });

  // The naive string is what let the page read a UTC bucket as local time.
  it('marks a SQLite datetime as the UTC it actually is', () => {
    assert.strictEqual(toInstant('2026-09-19 23:00'), '2026-09-19T23:00Z');
    assert.strictEqual(Date.parse(toInstant('2026-09-19 23:00:30')),
      Date.UTC(2026, 8, 19, 23, 0, 30));
    assert.strictEqual(toInstant(null), null);
  });
});
