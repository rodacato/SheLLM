const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Supplied by the OS, never by SheLLM's config. NODE_EXTRA_CA_CERTS is here because base.js
// forwards it to the CLI, and cli-env-secrets.test.js bars anything .env.example lists from one.
const NOT_OURS = new Set([
  'HOME', 'PATH', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NODE_EXTRA_CA_CERTS',
]);

function sourceFiles(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) sourceFiles(full, acc);
    else if (item.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function readVariables() {
  const found = new Set();
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, name] of text.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
      if (!NOT_OURS.has(name)) found.add(name);
    }
  }
  return found;
}

function documentedVariables() {
  const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const found = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^#?\s*([A-Z_0-9]+)=/);
    if (match) found.add(match[1]);
  }
  return found;
}

describe('configuration surface', () => {
  it('documents every variable src/ reads in .env.example', () => {
    const read = readVariables();
    const documented = documentedVariables();

    assert.ok(read.size > 10, `expected to find real variables, found ${read.size}`);

    const undocumented = [...read].filter((name) => !documented.has(name)).sort();
    assert.deepStrictEqual(
      undocumented,
      [],
      `read in src/ but absent from .env.example: ${undocumented.join(', ')}`,
    );
  });

  it('does not document a variable nothing reads', () => {
    const read = readVariables();
    const documented = documentedVariables();

    const orphaned = [...documented].filter((name) => !read.has(name)).sort();
    assert.deepStrictEqual(
      orphaned,
      [],
      `documented in .env.example but read nowhere in src/: ${orphaned.join(', ')}`,
    );
  });
});
