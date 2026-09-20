'use strict';

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
  const env = process.env.SHELLM_TZ || null;
  if (env !== cache.env) cache = { env, zone: resolveTimezone(env) };
  return cache.zone;
}

// SQLite stores wall-clock UTC with nothing saying so. Anything leaving the server says so.
function toInstant(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  return `${String(sqliteDatetime).replace(' ', 'T')}Z`;
}

module.exports = { DEFAULT_TIMEZONE, getTimezone, toInstant };
