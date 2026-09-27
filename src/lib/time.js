'use strict';

const config = require('../config');

const DEFAULT_TIMEZONE = 'America/Mexico_City';

// A bad zone name would otherwise throw on every render, taking the dashboard down over a typo.
function resolveTimezone(name) {
  if (!name) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name });
    return name;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

let cache = { env: null, zone: DEFAULT_TIMEZONE };

function getTimezone() {
  const env = config.get('SHELLM_TZ');
  if (env !== cache.env) cache = { env, zone: resolveTimezone(env) };
  return cache.zone;
}

// SQLite stores wall-clock UTC with nothing saying so. Anything leaving the server says so.
function toInstant(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  return `${String(sqliteDatetime).replace(' ', 'T')}Z`;
}

// Stored instants come in both shapes: SQLite's zoneless UTC and an ISO string that already ends
// in Z or an offset. Appending a second Z to the latter yields an Invalid Date.
function parseInstant(value) {
  if (!value) return null;
  const text = String(value);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { DEFAULT_TIMEZONE, getTimezone, toInstant, parseInstant };
