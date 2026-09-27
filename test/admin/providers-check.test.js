'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// "Run all checks" is judged against real binaries on PATH: they answer from files the test
// rewrites, and write down every argv they were started with.
describe('POST /admin/providers/check', () => {
  const originalPath = process.env.PATH;
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');
  let fakeBin;
  let request;
  let app;

  const state = (name) => path.join(fakeBin, name);
  const set = (name, value) => fs.writeFileSync(state(name), value);
  const calls = () => fs.readFileSync(state('calls'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  function writeCli(cli, body) {
    fs.writeFileSync(path.join(fakeBin, cli), `#!${process.execPath}
const fs = require('fs');
const dir = ${JSON.stringify(fakeBin)};
const args = process.argv.slice(2);
fs.appendFileSync(dir + '/calls', JSON.stringify({ cli: ${JSON.stringify(cli)}, args }) + '\\n');
const read = (name) => fs.readFileSync(dir + '/' + name, 'utf8');
const delay = Number(read('delay'));
setTimeout(() => {
${body}
}, delay);
`, { mode: 0o755 });
  }

  const providers = async () => (await request(app).get('/admin/providers').set('Authorization', `Basic ${adminCreds}`)).body.providers;
  const claude = async () => (await providers()).find((p) => p.name === 'claude');
  const check = () => request(app).post('/admin/providers/check').set('Authorization', `Basic ${adminCreds}`);

  before(() => {
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-check-'));
    set('calls', '');
    set('delay', '0');
    set('claude-version', '2.1.273');
    set('claude-logged-in', 'true');

    writeCli('claude', `if (args[0] === '--version') process.stdout.write(read('claude-version') + ' (Claude Code)');
else if (args[0] === 'auth') process.stdout.write(JSON.stringify({ loggedIn: read('claude-logged-in') === 'true' }));
else process.stdout.write('{"type":"result","result":"a real request"}');`);
    // app-server is the model catalog the providers list reads; left unanswered it waits out 25 s.
    writeCli('codex', `if (args[0] === '--version') process.stdout.write('codex-cli 0.154.0');
else if (args[0] === 'app-server') process.stdout.write('{"id":1,"result":null}\\n');
else process.stdout.write('Logged in using ChatGPT');`);

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');

    const { initDb } = require('../../src/db');
    initDb(':memory:');
    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.SHELLM_ADMIN_PASSWORD;
    require('../../src/db').closeDb();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('probes every provider and says when it last checked and last passed', async () => {
    const res = await check();
    assert.equal(res.status, 200);

    const listed = await providers();
    for (const name of ['claude', 'codex']) {
      const prov = listed.find((p) => p.name === name);
      assert.equal(prov.authenticated, true, `${name} was not probed`);
      assert.ok(Date.parse(prov.checked_at), `${name} has no check time`);
      assert.equal(prov.passed_at, prov.checked_at);
    }
    assert.equal(listed.find((p) => p.name === 'codex').version, '0.154.0');
  });

  it('re-reads a CLI version that changed under the running service', async () => {
    await check();
    assert.equal((await claude()).version, '2.1.273');

    set('claude-version', '2.1.274');
    assert.equal((await claude()).version, '2.1.273', 'the version is cached between checks');

    await check();
    assert.equal((await claude()).version, '2.1.274');
  });

  it('keeps the last pass when a later check fails', async () => {
    await check();
    const passed = (await claude()).passed_at;

    set('claude-logged-in', 'false');
    await check();
    const after = await claude();
    set('claude-logged-in', 'true');

    assert.equal(after.authenticated, false);
    assert.equal(after.passed_at, passed);
    assert.ok(after.checked_at > passed, 'the failing check was not stamped');
  });

  it('refuses a second press while a check is running', async () => {
    set('delay', '300');
    const [first, second] = await Promise.all([check(), new Promise((r) => setTimeout(r, 50)).then(check)]);
    set('delay', '0');

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'check_in_progress');
  });

  it('spends no quota: nothing but version and sign-in probes reaches a CLI', async () => {
    set('calls', '');
    await check();

    const seen = calls();
    assert.ok(seen.length >= 4, 'the check started no CLI');
    const probes = new Set(['--version', 'auth status', 'login status']);
    for (const { cli, args } of seen) {
      assert.ok(probes.has(args.join(' ')), `${cli} was started with ${args.join(' ')}`);
    }
  });

  it('requires admin auth', async () => {
    const res = await request(app).post('/admin/providers/check');
    assert.equal(res.status, 401);
  });
});
