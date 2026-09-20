'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DB_FILE, CONFIG_FILE, BACKUP_DIR } = require('./paths');

const DEFAULT_KEEP = 7;
const DB_NAME = 'shellm.db';
const CONFIG_NAME = 'config.env';
// Exactly what this command writes. Pruning matches this and nothing else, so it can never
// delete a file it did not create, and a `.partial-` directory left by a killed run is never
// mistaken for a snapshot.
const SNAPSHOT_NAME = /^\d{8}T\d{6}Z$/;

function parseArgs(argv) {
  const options = { dir: BACKUP_DIR, keep: String(DEFAULT_KEEP) };

  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=');
    const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    const value = eq === -1 ? argv[++i] : argv[i].slice(eq + 1);
    if (flag !== '--dir' && flag !== '--keep') {
      throw new Error(`unknown option ${flag} — usage: shellm backup [--dir DIR] [--keep N]`);
    }
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--dir') options.dir = path.resolve(value);
    else options.keep = value;
  }

  if (!/^\d+$/.test(options.keep) || Number(options.keep) < 1) {
    throw new Error(`--keep takes a whole number of snapshots to keep, at least 1 (got ${options.keep})`);
  }
  options.keep = Number(options.keep);
  return options;
}

// Opening a WAL database creates its -wal and -shm files when they are absent. As root those
// land root-owned in the service user's state directory, and the service can no longer write its
// own database — the exact failure this command exists to remove, moved to a path used nightly.
function assertNotRoot(uid) {
  if (uid !== 0) return;
  throw new Error(
    'refusing to run as root — it would leave root-owned -wal and -shm files beside the database '
    + `in ${path.dirname(DB_FILE)}, and the service could no longer write it. `
    + 'Run it as the user that owns the database: sudo -u shellmer -H shellm backup',
  );
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function makeBackupDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  } catch (err) {
    throw new Error(
      `cannot create ${dir}: ${err.code}. Create it once, owned by the user that runs this: `
      + `sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" ${dir}`,
    );
  }
}

// An empty file is a valid SQLite database: `PRAGMA integrity_check` answers ok for zero bytes,
// and so does a database with no tables. Neither is a snapshot of anything.
function verify(file) {
  const { size } = fs.statSync(file);
  if (size === 0) throw new Error('the snapshot came out empty');

  const Database = require('better-sqlite3');
  const copy = new Database(file, { fileMustExist: true });
  try {
    const [{ integrity_check: result }] = copy.pragma('integrity_check');
    if (result !== 'ok') throw new Error(`the snapshot failed its integrity check: ${result}`);
    const { tables } = copy.prepare("SELECT count(*) AS tables FROM sqlite_master WHERE type = 'table'").get();
    if (tables === 0) throw new Error('the snapshot holds no tables');
  } finally {
    copy.close();
  }
}

async function snapshot({ dir }) {
  if (!fs.existsSync(DB_FILE)) throw new Error(`no database at ${DB_FILE}`);
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`no config file at ${CONFIG_FILE}`);

  makeBackupDir(dir);
  const name = stamp();
  const target = path.join(dir, name);
  if (fs.existsSync(target)) throw new Error(`${target} already exists`);

  // Everything is written under a name that is not a snapshot and renamed into place once it has
  // been verified, so a failure anywhere above leaves no half-snapshot and touches no earlier one.
  const partial = path.join(dir, `.partial-${name}`);
  fs.mkdirSync(partial, { mode: 0o700 });
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_FILE, { fileMustExist: true });
    try {
      await db.backup(path.join(partial, DB_NAME));
    } finally {
      db.close();
    }
    fs.chmodSync(path.join(partial, DB_NAME), 0o600);
    verify(path.join(partial, DB_NAME));
    fs.writeFileSync(path.join(partial, CONFIG_NAME), fs.readFileSync(CONFIG_FILE), { mode: 0o600 });
    fs.renameSync(partial, target);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
  return target;
}

function prune(dir, keep) {
  const snapshots = fs.readdirSync(dir).filter((entry) => SNAPSHOT_NAME.test(entry)).sort().reverse();
  const stale = snapshots.slice(keep);
  for (const name of stale) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  return stale;
}

async function run(args = []) {
  try {
    const options = parseArgs(args);
    assertNotRoot(process.getuid ? process.getuid() : 1);
    const target = await snapshot(options);
    console.log(`Snapshot: ${target}`);
    console.log(`  ${DB_NAME} and ${CONFIG_NAME}, verified`);
    for (const name of prune(options.dir, options.keep)) console.log(`  pruned ${name}`);
  } catch (err) {
    console.error(`shellm backup: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { run, assertNotRoot, parseArgs, SNAPSHOT_NAME, DB_NAME, CONFIG_NAME };
