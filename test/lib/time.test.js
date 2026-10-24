'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TIMEZONE, getTimezone, toInstant, parseInstant, monthStartUtc, nextMonthStartUtc, toSqliteDatetime,
} = require('../../src/lib/time');

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

  it('parses a stored instant whether or not it already names its zone', () => {
    const utc = Date.UTC(2026, 9, 1, 6, 0, 0);
    assert.strictEqual(parseInstant('2026-10-01 06:00:00').getTime(), utc);
    assert.strictEqual(parseInstant('2026-10-01T06:00:00.000Z').getTime(), utc);
    assert.strictEqual(parseInstant('2026-10-01T01:00:00-05:00').getTime(), utc);
    assert.strictEqual(parseInstant('not a date'), null);
    assert.strictEqual(parseInstant(null), null);
  });

  it('bounds a month in UTC, rolling December into the next year', () => {
    const lateDecember = new Date('2026-12-31T23:30:00Z');
    assert.strictEqual(monthStartUtc(lateDecember).toISOString(), '2026-12-01T00:00:00.000Z');
    assert.strictEqual(nextMonthStartUtc(lateDecember).toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('writes an instant the way SQLite stores created_at', () => {
    assert.strictEqual(toSqliteDatetime(new Date('2026-10-01T00:00:00.000Z')), '2026-10-01 00:00:00');
  });
});
