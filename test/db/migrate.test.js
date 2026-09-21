const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrations, splitStatements } = require('../../src/db/migrate');

function setup(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'shellm-migrate-'));
  const migrationsDir = path.join(root, 'migrations');
  mkdirSync(migrationsDir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(path.join(migrationsDir, name), sql);
  }

  const db = new Database(path.join(root, 'shellm.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  return { db, migrationsDir };
}

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const appliedFiles = (db) => db.prepare('SELECT name FROM _migrations ORDER BY name').all().map(r => r.name);

describe('runMigrations', () => {
  it('applies every statement of a file with several ALTERs', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_init.sql': 'CREATE TABLE logs (id INTEGER PRIMARY KEY);',
      '002_metrics.sql': [
        '-- new columns, none of them present yet',
        'ALTER TABLE logs ADD COLUMN tokens_in INTEGER;',
        'ALTER TABLE logs ADD COLUMN tokens_out INTEGER;',
        'ALTER TABLE logs ADD COLUMN upstream_model TEXT;',
        'CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(upstream_model);',
      ].join('\n'),
    });

    runMigrations(db, migrationsDir);

    assert.deepEqual(columnsOf(db, 'logs'), ['id', 'tokens_in', 'tokens_out', 'upstream_model']);
    assert.deepEqual(appliedFiles(db), ['001_init.sql', '002_metrics.sql']);
  });

  it('keeps applying after a duplicate column in the first statement', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_init.sql': 'CREATE TABLE logs (id INTEGER PRIMARY KEY, tokens_in INTEGER);',
      '002_metrics.sql': [
        'ALTER TABLE logs ADD COLUMN tokens_in INTEGER;',
        'ALTER TABLE logs ADD COLUMN tokens_out INTEGER;',
        'ALTER TABLE logs ADD COLUMN upstream_model TEXT;',
      ].join('\n'),
    });

    runMigrations(db, migrationsDir);

    assert.deepEqual(columnsOf(db, 'logs'), ['id', 'tokens_in', 'tokens_out', 'upstream_model']);
    assert.deepEqual(appliedFiles(db), ['001_init.sql', '002_metrics.sql']);
  });

  it('fails loudly on a broken statement and leaves the file unapplied', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_init.sql': 'CREATE TABLE logs (id INTEGER PRIMARY KEY);',
      '002_broken.sql': [
        'ALTER TABLE logs ADD COLUMN tokens_in INTEGER;',
        'ALTER TABLE missing_table ADD COLUMN tokens_out INTEGER;',
      ].join('\n'),
    });

    assert.throws(() => runMigrations(db, migrationsDir), /no such table: missing_table/);

    assert.deepEqual(appliedFiles(db), ['001_init.sql']);
    assert.deepEqual(columnsOf(db, 'logs'), ['id']);
  });

  it('does not swallow a duplicate column outside an ALTER TABLE', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_broken_create.sql': 'CREATE TABLE logs (id INTEGER PRIMARY KEY, tokens INTEGER, tokens INTEGER);',
    });

    assert.throws(() => runMigrations(db, migrationsDir), /duplicate column name: tokens/);
    assert.deepEqual(appliedFiles(db), []);
  });

  it('skips files already recorded as applied', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_init.sql': 'CREATE TABLE logs (id INTEGER PRIMARY KEY);',
      '002_seed.sql': 'INSERT INTO logs (id) VALUES (1);',
    });

    runMigrations(db, migrationsDir);
    runMigrations(db, migrationsDir);

    assert.equal(db.prepare('SELECT count(*) AS c FROM logs').get().c, 1);
    assert.deepEqual(appliedFiles(db), ['001_init.sql', '002_seed.sql']);
  });

  it('runs a trigger body and a semicolon inside a literal as single statements', (t) => {
    const { db, migrationsDir } = setup(t, {
      '001_init.sql': [
        'CREATE TABLE logs (id INTEGER PRIMARY KEY, note TEXT, seen INTEGER);',
        'CREATE TRIGGER logs_seen AFTER INSERT ON logs',
        'BEGIN',
        '  UPDATE logs SET seen = 1 WHERE id = NEW.id;',
        'END;',
        "INSERT INTO logs (id, note) VALUES (1, 'a; b -- not a comment');",
      ].join('\n'),
    });

    runMigrations(db, migrationsDir);

    const row = db.prepare('SELECT note, seen FROM logs WHERE id = 1').get();
    assert.equal(row.note, 'a; b -- not a comment');
    assert.equal(row.seen, 1);
  });
});

describe('splitStatements', () => {
  it('ignores semicolons in comments, literals and CASE expressions', () => {
    const sql = [
      '-- a comment; with a semicolon',
      "INSERT INTO t (a) VALUES ('x; y');",
      '/* block; comment */',
      'UPDATE t SET a = CASE WHEN a IS NULL THEN 1 ELSE 2 END;',
    ].join('\n');

    const statements = splitStatements(sql).map(s => s.trim());
    assert.equal(statements.length, 2);
    assert.match(statements[0], /^-- a comment; with a semicolon\nINSERT/);
    assert.match(statements[1], /UPDATE t SET a = CASE/);
  });

  it('returns a trailing statement without its semicolon', () => {
    assert.deepEqual(splitStatements('SELECT 1').map(s => s.trim()), ['SELECT 1']);
  });
});
