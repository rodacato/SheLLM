'use strict';

const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const PASSWORD = 'correct-horse-battery-staple';

// The updater's health gate reads this, so it runs against the real app on a real port: the
// build it reports has to be the one the process was started from.
describe('shellm status --json', () => {
  let server;
  let readServing;
  let getBuildInfo;

  before(async () => {
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }
    process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;
    process.env.SHELLM_ADMIN_USER = 'admin';
    process.env.HOST = '127.0.0.1';

    const { initDb } = require('../../src/db');
    initDb(':memory:');
    const app = require('../../src/app');
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    process.env.PORT = String(server.address().port);
    // The server scrubs its secrets from its own environment; the CLI reads them from the config file.
    process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;

    ({ readServing } = require('../../src/cli/status'));
    ({ getBuildInfo } = require('../../src/infra/build-info'));
  });

  after(() => {
    server.close();
    require('../../src/db').closeDb();
    for (const key of ['SHELLM_ADMIN_PASSWORD', 'SHELLM_ADMIN_USER', 'HOST', 'PORT']) delete process.env[key];
  });

  it('reports the commit the running process was built from, and its status', async () => {
    const serving = await readServing();
    assert.equal(serving.reachable, true);
    assert.equal(serving.verified, true);
    assert.equal(serving.commit, getBuildInfo().commit);
    assert.ok(['ok', 'degraded', 'down'].includes(serving.status), serving.status);
  });

  it('says it could not verify rather than guessing when the admin password is wrong', async () => {
    process.env.SHELLM_ADMIN_PASSWORD = 'not-the-password-at-all';
    try {
      const serving = await readServing();
      assert.equal(serving.reachable, true);
      assert.equal(serving.verified, false);
      assert.match(serving.error, /401/);
    } finally {
      process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;
    }
  });

  it('reports an unreachable service as unreachable', async () => {
    const port = process.env.PORT;
    process.env.PORT = '1';
    try {
      assert.deepEqual(await readServing(), { reachable: false });
    } finally {
      process.env.PORT = port;
    }
  });
});
