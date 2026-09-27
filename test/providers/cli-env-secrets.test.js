const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const OWN_CREDENTIALS = { claude: ['CLAUDE_CODE_OAUTH_TOKEN'], codex: [] };

function exampleConfig() {
  const lines = fs.readFileSync(ENV_EXAMPLE, 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/gm);
  return Object.fromEntries([...lines].map(([, key, value]) => [key, value.replace(/^'(.*)'$/, '$1') || 'set']));
}

// ADR-0011: the floor is asserted on what the CLI actually received, not on the flag list.
describe('what a served request hands the CLI', () => {
  const originals = {};
  let fakeBin;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    for (const cli of ['claude', 'codex']) {
      const dump = path.join(fakeBin, `${cli}.env.json`);
      fs.writeFileSync(path.join(fakeBin, cli), `#!/usr/bin/env node
const fs = require('fs');
const seen = { env: process.env, argv: process.argv.slice(2), cwd: process.cwd(), files: fs.readdirSync('.') };
fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify(seen));
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

  async function serve(cli, request = { prompt: 'hi' }) {
    await require(`../../src/providers/${cli}`).chat(request);
    return JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.env.json`), 'utf8'));
  }

  const flagValue = (argv, flag) => argv[argv.indexOf(flag) + 1];

  it('keeps SheLLM secrets out of the CLI env', async () => {
    const configKeys = Object.keys(exampleConfig());
    assert.ok(configKeys.includes('SHELLM_ADMIN_PASSWORD'), '.env.example no longer lists the admin password');

    for (const cli of ['claude', 'codex']) {
      const childEnv = (await serve(cli)).env;
      const leaked = configKeys.filter((key) => key in childEnv && !OWN_CREDENTIALS[cli].includes(key));
      assert.deepStrictEqual(leaked, [], `${cli} received ${leaked.join(', ')}`);
    }
  });

  it('hands claude its own token and no other provider', async () => {
    for (const cli of ['claude', 'codex']) {
      const childEnv = (await serve(cli)).env;
      assert.strictEqual('CLAUDE_CODE_OAUTH_TOKEN' in childEnv, cli === 'claude', cli);
    }
  });

  it('runs claude with its tools, slash commands, MCP servers and hooks off', async () => {
    const { argv } = await serve('claude');
    assert.equal(flagValue(argv, '--tools'), '');
    assert.ok(argv.includes('--disable-slash-commands'));
    assert.ok(argv.includes('--strict-mcp-config'));
    assert.deepEqual(JSON.parse(flagValue(argv, '--settings')), { disableAllHooks: true });
  });

  it('runs codex in its read-only sandbox', async () => {
    const { argv } = await serve('codex');
    assert.equal(flagValue(argv, '-s'), 'read-only');
  });

  it('starts every CLI in a fresh directory outside the checkout holding only the request\'s own files', async () => {
    const withSystem = { prompt: 'hi', system: 'Be brief.' };
    for (const cli of ['claude', 'codex']) {
      const first = await serve(cli, withSystem);
      const second = await serve(cli);
      assert.ok(!first.cwd.startsWith(REPO_ROOT), `${cli} ran inside ${REPO_ROOT}`);
      assert.notEqual(first.cwd, second.cwd, `${cli} reused a directory`);
      const requestFiles = Object.keys(require(`../../src/providers/${cli}`).buildFiles(withSystem) || {});
      assert.deepEqual(first.files.sort(), requestFiles.sort(), `${cli} found ${first.files.join(', ')}`);
      assert.deepEqual(second.files, [], `${cli} found ${second.files.join(', ')}`);
    }
  });
});
