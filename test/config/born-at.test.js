'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fresh install must not be greeted by everything the release it installed introduced. These
// cases are the difference between that warning meaning something and meaning nothing.
describe('the release a config was born under', () => {
  let home;
  let configFile;
  let config;
  let savedHome;

  // CONFIG_FILE is resolved when src/cli/paths loads, so the temporary home has to be in place
  // before src/config is required, and both have to leave the cache afterwards.
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-born-'));
    fs.mkdirSync(path.join(home, 'shellm'));
    configFile = path.join(home, 'shellm', 'env');
    savedHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    for (const name of ['../../src/cli/paths', '../../src/config']) delete require.cache[require.resolve(name)];
    config = require('../../src/config');
  });

  after(() => {
    if (savedHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedHome;
    for (const name of ['../../src/cli/paths', '../../src/config']) delete require.cache[require.resolve(name)];
    fs.rmSync(home, { recursive: true, force: true });
  });

  function write(text) {
    fs.writeFileSync(configFile, text);
    config.reload();
  }

  const newest = () => config.names()
    .filter((name) => config.compare(config.schema[name].since, config.running()) >= 0);

  it('reads the marker, and reports null when there is none', () => {
    write('PORT=6100\n');
    assert.equal(config.configBornAt(), null);

    write('# shellm-config-version: v1.4.0\nPORT=6100\n');
    assert.equal(config.configBornAt(), 'v1.4.0');
  });

  it('tells a config born under this release that it is missing nothing', () => {
    write(`# shellm-config-version: ${config.running()}\nPORT=6100\n`);
    assert.deepStrictEqual(config.unseen(), [], 'a fresh install was warned about settings no release added for it');
  });

  it('still names them to a config written before the marker existed', () => {
    write('PORT=6100\n');
    assert.deepStrictEqual(config.unseen().sort(), newest().sort());
    assert.ok(config.unseen().length > 0, 'the case this whole check exists for produced nothing');
  });

  it('names them to a config born under an older release', () => {
    write('# shellm-config-version: v1.0.0\nPORT=6100\n');
    assert.deepStrictEqual(config.unseen().sort(), newest().sort());
  });

  it('never names a setting the config already sets', () => {
    const [first] = newest();
    write(`# shellm-config-version: v1.0.0\n${first}=whatever\n`);
    assert.ok(!config.unseen().includes(first), `${first} is set in the file and was still reported as missing`);
  });
});
