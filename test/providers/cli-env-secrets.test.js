const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_EXAMPLE = path.resolve(__dirname, '../../.env.example');

function exampleConfig() {
  const lines = fs.readFileSync(ENV_EXAMPLE, 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/gm);
  return Object.fromEntries([...lines].map(([, key, value]) => [key, value.replace(/^'(.*)'$/, '$1') || 'set']));
}

describe('CLI environment', () => {
  const originals = {};
  let fakeBin;

  before(() => {
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    for (const cli of ['claude', 'gemini']) {
      const dump = path.join(fakeBin, `${cli}.env.json`);
      fs.writeFileSync(path.join(fakeBin, cli), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));
process.stdout.write(JSON.stringify({ result: 'ok', response: 'ok' }));
`, { mode: 0o755 });
    }

    for (const key of [...Object.keys(exampleConfig()), 'PATH']) originals[key] = process.env[key];
    Object.assign(process.env, exampleConfig());
    process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH}`;
  });

  after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('keeps SheLLM secrets out of the CLI env', async () => {
    const configKeys = Object.keys(exampleConfig());
    assert.ok(configKeys.includes('SHELLM_ADMIN_PASSWORD'), '.env.example no longer lists the admin password');

    for (const cli of ['claude', 'gemini']) {
      await require(`../../src/providers/${cli}`).chat({ prompt: 'hi' });
      const childEnv = JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.env.json`), 'utf8'));
      const leaked = configKeys.filter((key) => key in childEnv);
      assert.deepStrictEqual(leaked, [], `${cli} received ${leaked.join(', ')}`);
    }
  });
});
