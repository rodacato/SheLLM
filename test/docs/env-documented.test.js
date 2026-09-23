const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('../../src/config/schema');
const { render, TARGET } = require('../../scripts/build-env-example');

const ROOT = path.join(__dirname, '..', '..');

// Supplied by the OS, never by SheLLM's config. NODE_EXTRA_CA_CERTS is here because base.js
// forwards it to the CLI, and cli-env-secrets.test.js bars anything the schema lists from one.
const NOT_OURS = new Set([
  'HOME', 'PATH', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NODE_EXTRA_CA_CERTS',
  'INVOCATION_ID',
]);

// The config module is the accessor every other file now goes through: the schema names all 33,
// and index.js mentions the shape it replaced. Scanning either proves nothing about call sites.
const CONFIG_MODULE = new Set(['src/config/schema.js', 'src/config/index.js']);

function sourceFiles(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) sourceFiles(full, acc);
    else if (item.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

// Both spellings: the migration left a handful of direct reads (the admin password is read and
// then deleted from the environment, which a lazy accessor cannot do), and everything else asks
// the config module by name.
function readVariables() {
  const found = new Set();
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    if (CONFIG_MODULE.has(path.relative(ROOT, file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [, name] of text.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
      if (!NOT_OURS.has(name)) found.add(name);
    }
    for (const [, name] of text.matchAll(/config\.get\('([A-Z_0-9]+)'\)/g)) found.add(name);
  }
  return found;
}

describe('configuration surface', () => {
  it('declares every variable src/ reads in the schema', () => {
    const read = readVariables();
    assert.ok(read.size > 10, `expected to find real variables, found ${read.size}`);

    const undeclared = [...read].filter((name) => !schema[name]).sort();
    assert.deepStrictEqual(
      undeclared,
      [],
      `read in src/ but absent from src/config/schema.js: ${undeclared.join(', ')}`,
    );
  });

  it('does not declare a variable nothing reads', () => {
    const read = readVariables();
    const orphaned = Object.keys(schema).filter((name) => !read.has(name)).sort();
    assert.deepStrictEqual(
      orphaned,
      [],
      `declared in the schema but read nowhere in src/: ${orphaned.join(', ')}`,
    );
  });

  it('has a committed .env.example that matches what the schema generates', () => {
    assert.equal(
      fs.readFileSync(TARGET, 'utf8'),
      render(),
      'run `npm run config:build` — .env.example is generated from src/config/schema.js',
    );
  });
});
