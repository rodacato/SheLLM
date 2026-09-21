'use strict';

const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function skipQuoted(sql, start, quote) {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) { i += 2; continue; }
      return i;
    }
    i++;
  }
  return sql.length;
}

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let blockDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? sql.length : eol;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 1;
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i, ch);
    } else if (ch === '[') {
      const close = sql.indexOf(']', i + 1);
      i = close === -1 ? sql.length : close;
    } else if (/[A-Za-z_]/.test(ch)) {
      let end = i;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end++;
      // A trigger body and a CASE expression both hold semicolons that end no statement.
      const word = sql.slice(i, end).toUpperCase();
      if (word === 'BEGIN' || word === 'CASE') blockDepth++;
      else if (word === 'END' && blockDepth > 0) blockDepth--;
      i = end - 1;
    } else if (ch === ';' && blockDepth === 0) {
      const statement = sql.slice(start, i + 1);
      if (statement.trim()) statements.push(statement);
      start = i + 1;
    }
  }

  const tail = sql.slice(start);
  if (tail.trim()) statements.push(tail);
  return statements;
}

function withoutLeadingComments(statement) {
  let i = 0;
  while (i < statement.length) {
    if (/\s/.test(statement[i])) { i++; continue; }
    if (statement[i] === '-' && statement[i + 1] === '-') {
      const eol = statement.indexOf('\n', i);
      i = eol === -1 ? statement.length : eol + 1;
      continue;
    }
    if (statement[i] === '/' && statement[i + 1] === '*') {
      const close = statement.indexOf('*/', i + 2);
      i = close === -1 ? statement.length : close + 2;
      continue;
    }
    break;
  }
  return statement.slice(i);
}

function isDuplicateColumn(err, statement) {
  return /duplicate column/i.test(err.message || '')
    && /^alter\s+table\b/i.test(withoutLeadingComments(statement));
}

function applyMigration(database, file, sql) {
  for (const statement of splitStatements(sql)) {
    try {
      database.exec(statement);
    } catch (err) {
      if (!isDuplicateColumn(err, statement)) throw err;
    }
  }
  database.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(file);
}

function runMigrations(database, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  database.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  if (!existsSync(migrationsDir)) return;

  const applied = new Set(database.prepare('SELECT name FROM _migrations').all().map(r => r.name));
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applyMigrationAtomically = database.transaction(applyMigration);

  for (const file of files) {
    if (applied.has(file)) continue;
    applyMigrationAtomically(database, file, readFileSync(path.join(migrationsDir, file), 'utf-8'));
  }
}

module.exports = { runMigrations, splitStatements, DEFAULT_MIGRATIONS_DIR };
