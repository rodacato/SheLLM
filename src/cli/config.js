'use strict';

const { CONFIG_FILE } = require('./paths');
const config = require('../config');
const schema = require('../config/schema');

// The dashboard reports the same bounded list, so the comparison lives with the schema it reads.
const { unseen, compare } = config;
const RUNNING = config.running();

function wrap(text, width) {
  const lines = [];
  let current = '';
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  return current ? [...lines, current] : lines;
}

function render(value) {
  if (value === null) return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(',');
  return String(value);
}

function table() {
  const rows = config.all();
  const width = Math.max(...rows.map((row) => row.name.length));
  const valueWidth = Math.max(...rows.map((row) => render(row.value).length), 5);

  console.log(`${'SETTING'.padEnd(width)}  ${'VALUE'.padEnd(valueWidth)}  SOURCE         SINCE    RELOAD`);
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(width)}  ${render(row.value).padEnd(valueWidth)}  ` +
      `${row.source.padEnd(14)} ${row.since.padEnd(8)} ${row.reload}`,
    );
  }
  console.log(`\nConfig file: ${CONFIG_FILE}`);
}

function newOnly() {
  const names = unseen();
  if (names.length === 0) {
    console.log(`No settings introduced in ${RUNNING} or later are missing from your config.`);
    return;
  }
  console.log(`${names.length} setting${names.length === 1 ? '' : 's'} your config does not set:\n`);
  for (const name of names) {
    const entry = schema[name];
    console.log(`  ${name}  (${entry.since}, ${entry.reload})`);
    for (const line of wrap(entry.describe, 74)) console.log(`    ${line}`);
    const example = entry.example ?? (entry.default === null ? '' : entry.default);
    console.log(`    ${name}=${entry.secret ? '' : example}\n`);
  }
  console.log(`Add what you want to ${CONFIG_FILE}, then apply it:\n`);
  console.log(`  ${config.restartCommand()}`);
}

function run(args) {
  if (args.includes('--new')) return newOnly();
  return table();
}

module.exports = { run, unseen, compare };
