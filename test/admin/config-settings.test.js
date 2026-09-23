'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A secret that is only ever written to the config module's environment. Any appearance of it in
// an HTTP body is the failure this suite exists to catch.
const HMAC_SECRET = 'never-leaves-the-host-9f3a';
const GLOBAL_RPM = '77';

describe('admin /admin/config', () => {
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');
  let request;
  let app;
  let config;
  let schema;
  let home;
  let configFile;
  const saved = {};

  const read = () => request(app).get('/admin/config').set('Authorization', `Basic ${adminCreds}`);

  // The config file is resolved from XDG_CONFIG_HOME when src/cli/paths loads, so the whole of
  // src/ is re-required after the temporary home is in place.
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-config-'));
    fs.mkdirSync(path.join(home, 'shellm'));
    configFile = path.join(home, 'shellm', 'env');
    fs.writeFileSync(configFile, '');

    for (const name of ['XDG_CONFIG_HOME', 'SHELLM_ADMIN_PASSWORD', 'SHELLM_HMAC_SECRET', 'SHELLM_GLOBAL_RPM']) {
      saved[name] = process.env[name];
    }
    process.env.XDG_CONFIG_HOME = home;
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';
    process.env.SHELLM_HMAC_SECRET = HMAC_SECRET;
    process.env.SHELLM_GLOBAL_RPM = GLOBAL_RPM;

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }

    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* nothing was open */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../../src/app');
    config = require('../../src/config');
    schema = require('../../src/config/schema');
  });

  after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const { closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* already closed */ }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('answers 401 without admin credentials', async () => {
    const res = await request(app).get('/admin/config');
    assert.strictEqual(res.status, 401);
  });

  it('returns one entry per setting the schema declares', async () => {
    const res = await read();

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.settings.map((setting) => setting.name).sort(),
      Object.keys(schema).sort(),
    );
    for (const setting of res.body.settings) {
      const entry = schema[setting.name];
      assert.strictEqual(setting.since, entry.since, `${setting.name} reports the wrong release`);
      assert.strictEqual(setting.reload, entry.reload, `${setting.name} reports the wrong reload class`);
      assert.strictEqual(setting.describe, entry.describe, `${setting.name} carries no description`);
      assert.ok(['default', 'config file', 'environment'].includes(setting.source), `${setting.name} has source ${setting.source}`);
    }
  });

  it('says which file the operator writes, and what this host runs', async () => {
    const res = await read();

    assert.strictEqual(res.body.config_file, configFile);
    assert.strictEqual(res.body.running, `v${require('../../package.json').version}`);
  });

  it('masks a secret and never sends its value', async () => {
    const res = await read();
    const secret = res.body.settings.find((setting) => setting.name === 'SHELLM_HMAC_SECRET');

    assert.ok(secret, 'the secret is no longer in the schema — this check proves nothing');
    assert.strictEqual(secret.secret, true);
    assert.strictEqual(secret.value, '********');
    assert.ok(
      !JSON.stringify(res.body).includes(HMAC_SECRET),
      'the real secret reached the dashboard somewhere in the body',
    );
  });

  it('still reports the value of a setting that is not a secret', async () => {
    const res = await read();
    const rpm = res.body.settings.find((setting) => setting.name === 'SHELLM_GLOBAL_RPM');

    assert.strictEqual(rpm.value, Number(GLOBAL_RPM), 'masking swallowed a value nobody asked to hide');
    assert.strictEqual(rpm.source, 'environment');
    assert.strictEqual(rpm.secret, false);
  });

  it('names only settings this release introduced, and every one of them is a real setting', async () => {
    const res = await read();

    assert.ok(
      res.body.unseen.length > 0,
      `no setting is declared with since: ${config.running()} — point this fixture at a release that introduced one, or drop the case`,
    );
    const names = new Set(res.body.settings.map((setting) => setting.name));
    for (const name of res.body.unseen) {
      assert.ok(names.has(name), `${name} is reported as new and is not in the settings table`);
      assert.strictEqual(config.compare(schema[name].since, config.running()), 0, `${name} predates the running release`);
    }
  });

  it('stops naming a setting once the config file sets it', async () => {
    const before = (await read()).body.unseen;
    const [adopted, ...rest] = before;

    fs.writeFileSync(configFile, `${adopted}=whatever\n`);
    config.reload();
    const after = (await read()).body.unseen;

    assert.ok(!after.includes(adopted), `${adopted} is set in the config file and is still reported as new`);
    assert.deepStrictEqual(after, rest, 'the settings the file still does not set went missing');

    fs.writeFileSync(configFile, '');
    config.reload();
  });
});

// The page's own file, loaded the way the browser loads it; only fetch is stood in for.
function loadSystemPage(fetchImpl) {
  const vm = require('node:vm');
  const jsDir = path.join(__dirname, '../../src/admin/public/js');
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams, Set,
    fetch: fetchImpl,
    navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'system.js']) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), 'utf8'), context, { filename: file });
  }
  return context.systemPage();
}

describe('the System page reads the settings it renders', () => {
  const body = {
    running: 'v1.10.0',
    config_file: '/home/shellmer/.config/shellm/env',
    settings: [
      { name: 'PORT', value: 6100, source: 'default', since: 'v0.1.0', reload: 'restart', describe: 'Port', secret: false },
      { name: 'SHELLM_CORS_ORIGINS', value: [], source: 'default', since: 'v1.10.0', reload: 'live', describe: 'Origins', secret: false },
      { name: 'SHELLM_HMAC_SECRET', value: '********', source: 'environment', since: 'v0.4.0', reload: 'restart', describe: 'HMAC', secret: true },
    ],
    unseen: ['SHELLM_CORS_ORIGINS'],
  };

  const answer = (status, payload) => async () => ({
    ok: status < 400, status, json: async () => payload, headers: { get: () => null },
  });

  const loaded = async () => {
    const page = loadSystemPage(answer(200, body));
    await page.fetchConfig();
    return page;
  };

  it('keeps the whole table and resolves the new names against it', async () => {
    const page = await loaded();

    assert.strictEqual(page.configError, null);
    assert.strictEqual(page.settings.length, 3);
    assert.strictEqual(page.unseenSettings.length, 1);
    assert.strictEqual(page.unseenSettings[0].describe, 'Origins', 'a new setting arrives without its description');
    assert.strictEqual(page.configFile, '/home/shellmer/.config/shellm/env');
  });

  it('counts the new settings the way an operator reads them', async () => {
    const page = await loaded();

    assert.strictEqual(page.unseenHeadline, '1 setting is available and not set in your config');
    page.unseenSettings = [...page.unseenSettings, ...page.unseenSettings];
    assert.strictEqual(page.unseenHeadline, '2 settings are available and not set in your config');
  });

  it('writes a line that can be pasted, and never one carrying a secret', async () => {
    const page = await loaded();
    const line = (name) => page.settingLine(page.settings.find((setting) => setting.name === name));

    assert.strictEqual(line('PORT'), 'PORT=6100');
    assert.strictEqual(line('SHELLM_CORS_ORIGINS'), 'SHELLM_CORS_ORIGINS=');
    assert.strictEqual(line('SHELLM_HMAC_SECRET'), 'SHELLM_HMAC_SECRET=', 'the mask was offered as a value to paste');
  });

  it('says it could not read, rather than rendering an empty table as the answer', async () => {
    const page = loadSystemPage(answer(500, { error: 'boom' }));
    await page.fetchConfig();

    assert.strictEqual(page.configLoaded, true);
    assert.ok(page.configError, 'a failed read leaves nothing for the table to say');
    assert.strictEqual(page.settings.length, 0, 'and it must not invent settings');
  });
});

describe('the System page shows what the release added', () => {
  const { compose } = require('../../src/admin/views');

  const settingsBlock = () => {
    const html = compose();
    const page = html.slice(html.indexOf('<!-- SYSTEM PAGE -->'));
    const start = page.indexOf('<!-- ================= SETTINGS');
    const end = page.indexOf('<!-- ================= QUEUE', start);
    assert.ok(start > -1 && end > start, 'the Settings block is no longer a section of the System page');
    return page.slice(start, end);
  };

  it('puts the block after the Build card it follows', () => {
    const page = compose().slice(compose().indexOf('<!-- SYSTEM PAGE -->'));
    assert.ok(page.indexOf('>Build<') < page.indexOf('<!-- ================= SETTINGS'));
  });

  it('leads with the settings the operator has not set, in the warning colour', () => {
    const block = settingsBlock();
    assert.match(block, /x-if="unseenSettings\.length > 0"/, 'nothing renders the new-settings list');
    assert.match(block, /text-status-warn[^>]*x-text="unseenHeadline"/, 'the headline is not drawn as a warning');
    assert.ok(block.includes('x-text="settingLine(setting)"'), 'the line to copy into the config file is gone');
    assert.ok(block.includes('x-text="setting.describe"'), 'a new setting is named without saying what it does');
  });

  it('draws the whole table underneath, and says where the file lives', () => {
    const block = settingsBlock();
    for (const column of ['Setting', 'Value', 'Source', 'Since', 'Reload']) {
      assert.ok(block.includes(`>${column}</th>`), `the table lost its ${column} column`);
    }
    assert.ok(block.includes('x-text="settingValue(setting)"'), 'the value cell reads nothing');
    assert.match(block, /x-text="'Write them in ' \+ configFile"/, 'the page never says which file to write');
  });
});
