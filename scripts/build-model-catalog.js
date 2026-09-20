'use strict';

// Writes src/catalog/models.json by asking the CLIs installed here. The result is the floor the
// service falls back to when it cannot ask for itself — never the source of truth, because the
// host that runs it has its own binaries and its own account.
//
// Run it in the dev container, where both CLIs are installed and signed in, and commit the result:
// a model retiring then shows up as a deleted line in a pull request.

const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { listCodexModels, listClaudeModels } = require('../src/providers/model-list');
const { execute } = require('../src/providers/base');

const OUT = path.join(__dirname, '../src/catalog/models.json');

async function cliVersion(name) {
  try {
    const { stdout } = await execute(name, ['--version'], { timeout: 20_000 });
    return /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const providers = {};
  const cli = {};

  for (const [name, lister] of [['codex', listCodexModels], ['claude', listClaudeModels]]) {
    const models = await lister({});
    cli[name] = await cliVersion(name);
    if (!models) {
      console.error(`  ${name}: no catalog — leaving it out rather than writing an empty one`);
      continue;
    }
    providers[name] = { models };
    console.log(`  ${name} ${cli[name] ?? '?'}: ${models.length} models`);
  }

  if (Object.keys(providers).length === 0) {
    console.error('No provider answered. Not writing a catalog of nothing.');
    process.exit(1);
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({
    generated_at: new Date().toISOString().slice(0, 10),
    cli,
    providers,
  }, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(process.cwd(), OUT)}`);
}

main();
