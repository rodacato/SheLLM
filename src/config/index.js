'use strict';

const fs = require('node:fs');
const schema = require('./schema');
const { CONFIG_FILE } = require('../cli/paths');

// Parsed separately from the copy dotenv already merged into process.env. Once merged the two are
// indistinguishable, and telling them apart is the whole point of sourceOf(): pg_settings answers
// "where did this value come from", and so does this.
let fileCache = null;
let fileCachePath = null;

function fromFile() {
  if (fileCache && fileCachePath === CONFIG_FILE) return fileCache;
  fileCachePath = CONFIG_FILE;
  // Required here rather than at the top: get() needs only process.env, so a caller that never
  // asks where a value came from works without the dependency resolvable.
  const dotenv = require('dotenv');
  try {
    fileCache = dotenv.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    fileCache = {};
  }
  return fileCache;
}

// Tests and `shellm init` write the config while the process is running.
function reload() {
  fileCache = null;
  fileCachePath = null;
}

function entryOf(name) {
  const entry = schema[name];
  if (!entry) throw new Error(`Unknown setting: ${name}`);
  return entry;
}

// The two boolean idioms in the code are opposites, and which one applies follows from the
// default: a setting that is on unless you turn it off reads `!== 'false'`, one that is off
// unless you turn it on reads `=== 'true'`. Deriving it preserves both call sites exactly.
function coerceBool(value, defaultsTo) {
  return defaultsTo === true ? value !== 'false' : value === 'true';
}

function coerce(value, entry) {
  switch (entry.type) {
    case 'int': return parseInt(value, 10);
    case 'bool': return coerceBool(value, entry.default);
    case 'list': return String(value).split(',').map((item) => item.trim()).filter(Boolean);
    default: return value;
  }
}

// An empty value is an unset one, which is what `process.env.X || 'default'` meant in every call
// site this replaced. Preserving it is what keeps the migration behaviour-neutral.
function rawValue(name) {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function get(name) {
  const entry = entryOf(name);
  const raw = rawValue(name);
  if (raw === null) return entry.default;
  return coerce(raw, entry);
}

// `default` | `config file` | `environment`, after pg_settings. A name the real environment and the
// config file both carry reads as `environment`, because dotenv leaves an existing value alone —
// so the file's copy is not what is in effect.
function sourceOf(name) {
  entryOf(name);
  const raw = rawValue(name);
  if (raw === null) return 'default';
  const file = fromFile()[name];
  if (file !== undefined && file === process.env[name]) return 'config file';
  return 'environment';
}

// Absent from the operator's config file — which is not the same as unset, and is the question
// doctor and the dashboard ask.
function isInConfigFile(name) {
  entryOf(name);
  return Object.prototype.hasOwnProperty.call(fromFile(), name);
}

function names() {
  return Object.keys(schema);
}

function all() {
  return names().map((name) => {
    const entry = schema[name];
    return {
      name,
      value: entry.secret && get(name) !== null ? '********' : get(name),
      source: sourceOf(name),
      since: entry.since,
      reload: entry.reload,
      describe: entry.describe,
      // What to put after the equals sign when the value in effect is the empty default, so the
      // line the dashboard offers is one the operator can paste rather than one they must finish.
      example: entry.secret ? null : entry.example ?? null,
      secret: Boolean(entry.secret),
    };
  });
}

// Read at call time rather than at load: the server is expected to run from a tree that is only
// src/, and the manifest sits above it.
function running() {
  return `v${require('../../package.json').version}`;
}

function compare(a, b) {
  const left = a.replace(/^v/, '').split('.').map(Number);
  const right = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

// A setting the operator has never been shown: absent from the config file and introduced by a
// release no older than the one running. This is the bounded list — the full set of unset
// settings is 20-odd lines of noise, and is what `shellm config` prints on request.
function unseen() {
  const version = running();
  return names()
    .filter((name) => !isInConfigFile(name))
    .filter((name) => compare(schema[name].since, version) >= 0);
}

module.exports = {
  get, sourceOf, isInConfigFile, names, all, reload, schema, unseen, compare, running,
};
