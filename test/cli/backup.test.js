'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const CLI = path.resolve(__dirname, '../../src/cli.js');
const DB_MODULE = path.resolve(__dirname, '../../src/db');
const BETTER_SQLITE3 = require.resolve('better-sqlite3');
const { SNAPSHOT_NAME, DB_NAME, CONFIG_NAME } = require('../../src/cli/backup');

let home;
let backups;

function shellm(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { HOME: home, PATH: process.env.PATH, ...env }, timeout: 60000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

function dbFile() {
  return path.join(home, '.shellm', 'shellm.db');
}

function snapshots() {
  return fs.readdirSync(backups).filter((entry) => SNAPSHOT_NAME.test(entry)).sort();
}

// A real database through the real module: initDb runs the migrations, so what is snapshotted is
// the schema the service actually has.
function seedDatabase(name = 'test') {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e',
      `const db = require(${JSON.stringify(DB_MODULE)}); db.initDb(); `
      + `process.stdout.write(db.createClient({ name: ${JSON.stringify(name)} }).rawKey);`],
    { env: { HOME: home } }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

function writeConfig() {
  fs.mkdirSync(path.join(home, '.config', 'shellm'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'shellm', 'env'),
    'HOST=127.0.0.1\nSHELLM_ADMIN_PASSWORD=a-secret-nobody-else-should-read\n', { mode: 0o600 });
}

describe('shellm backup', () => {
  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-backup-home-'));
    backups = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-backup-dir-'));
    writeConfig();
    await seedDatabase();
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(backups, { recursive: true, force: true });
  });

  it('writes the database and the config file into one timestamped directory', async () => {
    const result = await shellm(['backup', '--dir', backups]);
    assert.strictEqual(result.code, 0, result.stdout + result.stderr);

    const [name] = snapshots();
    assert.ok(name, `no snapshot in ${backups}: ${fs.readdirSync(backups)}`);
    const snapshot = path.join(backups, name);
    assert.match(result.stdout, new RegExp(snapshot));

    const copy = new Database(path.join(snapshot, DB_NAME), { fileMustExist: true, readonly: false });
    assert.deepEqual(copy.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    assert.strictEqual(copy.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
    copy.close();

    assert.match(fs.readFileSync(path.join(snapshot, CONFIG_NAME), 'utf8'), /SHELLM_ADMIN_PASSWORD=/);
  });

  it('keeps the config copy and the database copy unreadable to other users', async () => {
    await shellm(['backup', '--dir', backups]);
    const snapshot = path.join(backups, snapshots()[0]);

    assert.strictEqual(fs.statSync(path.join(snapshot, CONFIG_NAME)).mode & 0o777, 0o600,
      'the config file carries the admin password and the CLI OAuth tokens');
    assert.strictEqual(fs.statSync(path.join(snapshot, DB_NAME)).mode & 0o777, 0o600,
      'the database carries the API key hashes and the request log');
    assert.strictEqual(fs.statSync(snapshot).mode & 0o777, 0o700);
  });

  it('refuses to run as root, because it would leave root-owned WAL files behind', async (t) => {
    const sudo = await new Promise((resolve) => {
      execFile('sudo', ['-n', 'true'], (err) => resolve(!err));
    });
    if (!sudo) return t.skip('no passwordless sudo here');

    // The dangerous shape exactly: root, with HOME pointing at the service user's home. A bare
    // `sudo shellm backup` is safe by accident, because it looks for /root/.shellm and finds none.
    const result = await new Promise((resolve) => {
      execFile('sudo', ['-n', 'env', `HOME=${home}`, process.execPath, CLI, 'backup', '--dir', backups],
        { timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    });

    assert.notStrictEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /refusing to run as root/);
    assert.deepEqual(snapshots(), [], 'it wrote a snapshot anyway');
    for (const entry of fs.readdirSync(path.join(home, '.shellm'))) {
      const { uid } = fs.statSync(path.join(home, '.shellm', entry));
      assert.strictEqual(uid, process.getuid(), `${entry} is owned by uid ${uid}, not the service user`);
    }
  });

  describe('with another process writing to the database', () => {
    let writer;

    beforeEach(async () => {
      writer = spawn(process.execPath, ['-e', `
        const Database = require(${JSON.stringify(BETTER_SQLITE3)});
        const db = new Database(${JSON.stringify(dbFile())});
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE IF NOT EXISTS load (n INTEGER PRIMARY KEY)');
        const insert = db.prepare('INSERT INTO load (n) VALUES (?)');
        let n = 0;
        setInterval(() => { for (let i = 0; i < 100; i++) insert.run(n++); process.stdout.write('.'); }, 5);
      `], { stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise((resolve, reject) => {
        writer.stdout.once('data', resolve);
        writer.once('error', reject);
      });
    });

    afterEach(() => writer.kill('SIGKILL'));

    it('takes a snapshot under concurrent writes that restores intact', async () => {
      const result = await shellm(['backup', '--dir', backups]);
      assert.strictEqual(result.code, 0, result.stdout + result.stderr);

      const copy = new Database(path.join(backups, snapshots()[0], DB_NAME), { fileMustExist: true });
      assert.deepEqual(copy.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
      assert.strictEqual(copy.prepare('SELECT count(*) AS n FROM clients').get().n, 1,
        'the rows written before the writer started are missing');

      // A consistent snapshot is a prefix of committed transactions, so the sequence the writer
      // inserts has to come out contiguous. A torn copy shows up as a gap.
      const { rows, highest } = copy.prepare('SELECT count(*) AS rows, max(n) AS highest FROM load').get();
      assert.ok(rows > 0, 'the snapshot caught none of the concurrent writes — it proves nothing');
      assert.strictEqual(rows, highest + 1, `${rows} rows but the highest is ${highest}: the copy is torn`);
      copy.close();
    });

    it('leaves the -wal and -shm files beside the database owned by the user that ran it', async () => {
      const result = await shellm(['backup', '--dir', backups]);
      assert.strictEqual(result.code, 0, result.stdout + result.stderr);

      const state = path.join(home, '.shellm');
      const wal = fs.readdirSync(state).filter((entry) => entry.endsWith('-wal') || entry.endsWith('-shm'));
      assert.deepEqual(wal.sort(), ['shellm.db-shm', 'shellm.db-wal'],
        'the live database has no WAL files, so this test is not checking anything');
      for (const entry of [...wal, 'shellm.db']) {
        assert.strictEqual(fs.statSync(path.join(state, entry)).uid, process.getuid(), `${entry} changed owner`);
      }
    });
  });

  it('exits non-zero, so a caller running under set -e stops', async () => {
    fs.rmSync(dbFile());
    const script = `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} backup --dir ${JSON.stringify(backups)}; echo REACHED`;
    const result = await new Promise((resolve) => {
      execFile('bash', ['-e', '-c', script], { env: { HOME: home, PATH: process.env.PATH }, timeout: 60000 },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    });

    assert.notStrictEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /REACHED/, 'the caller carried on after a backup that never happened');
    assert.match(result.stderr, /no database at/);
  });

  it('leaves no partial snapshot when the database cannot be read', async () => {
    fs.chmodSync(dbFile(), 0o000);
    const result = await shellm(['backup', '--dir', backups]);
    fs.chmodSync(dbFile(), 0o600);

    assert.notStrictEqual(result.code, 0, result.stdout);
    assert.deepEqual(fs.readdirSync(backups), [], 'something was left behind in the backup directory');
  });

  it('keeps the previous snapshot when a later one fails', async () => {
    await shellm(['backup', '--dir', backups]);
    const [good] = snapshots();
    const before = fs.readFileSync(path.join(backups, good, DB_NAME));

    fs.chmodSync(dbFile(), 0o000);
    const result = await shellm(['backup', '--dir', backups]);
    fs.chmodSync(dbFile(), 0o600);

    assert.notStrictEqual(result.code, 0, result.stdout);
    assert.deepEqual(snapshots(), [good]);
    assert.deepEqual(fs.readFileSync(path.join(backups, good, DB_NAME)), before);
  });

  it('fails without writing anything when the destination cannot be created', async () => {
    const readOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-backup-ro-'));
    fs.chmodSync(readOnly, 0o500);
    try {
      const result = await shellm(['backup', '--dir', path.join(readOnly, 'snapshots')]);
      assert.notStrictEqual(result.code, 0, result.stdout);
      assert.match(result.stderr, /cannot create/);
      assert.deepEqual(fs.readdirSync(readOnly), []);
    } finally {
      fs.chmodSync(readOnly, 0o700);
      fs.rmSync(readOnly, { recursive: true, force: true });
    }
  });

  it('refuses a snapshot of an empty database instead of reporting success', async () => {
    // An empty file is a valid SQLite database: PRAGMA integrity_check answers ok for zero bytes,
    // which is the false positive that makes "the backup ran" and "there is a backup" different.
    fs.writeFileSync(dbFile(), '');
    const result = await shellm(['backup', '--dir', backups]);

    assert.notStrictEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /empty|no tables/);
    assert.deepEqual(fs.readdirSync(backups), []);
  });

  it('prunes its own old snapshots and nothing else', async () => {
    fs.mkdirSync(path.join(backups, '20200101T000000Z'));
    fs.mkdirSync(path.join(backups, '20200102T000000Z'));
    fs.mkdirSync(path.join(backups, '.partial-20200103T000000Z'));
    fs.writeFileSync(path.join(backups, 'shellm-backup-i-made-myself.db'), 'mine');

    const result = await shellm(['backup', '--dir', backups, '--keep', '2']);
    assert.strictEqual(result.code, 0, result.stdout + result.stderr);

    const kept = snapshots();
    assert.strictEqual(kept.length, 2);
    assert.ok(kept.includes('20200102T000000Z'), 'it pruned newest-first');
    assert.ok(!kept.includes('20200101T000000Z'), 'the oldest snapshot survived --keep 2');
    assert.ok(fs.existsSync(path.join(backups, 'shellm-backup-i-made-myself.db')),
      'pruning deleted a file this command did not write');
    assert.ok(fs.existsSync(path.join(backups, '.partial-20200103T000000Z')),
      'a killed run left that behind; it is not a snapshot and pruning must not count it as one');
  });

  it('rejects a --keep that would delete every snapshot', async () => {
    const result = await shellm(['backup', '--dir', backups, '--keep', '0']);
    assert.notStrictEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /--keep/);
  });
});
