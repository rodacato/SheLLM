'use strict';

const { describe, it, mock, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The endpoint's job is to refuse. It writes one small file, and everything else it does is
// deciding not to — which is the part worth pinning down, because each refusal corresponds to a
// way the host could be left somewhere nobody chose.
describe('admin /admin/update', () => {
  let request;
  let app;
  let state;
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');

  const post = (body) => request(app).post('/admin/update')
    .set('Authorization', `Basic ${adminCreds}`)
    .set('Content-Type', 'application/json')
    .send(body);

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';

    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({ stdout: 'v1.0.0', stderr: '', duration_ms: 10 })),
        stripNonPrintable: (t) => t,
      },
    });
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });

    // The real module shells out to systemd and writes to /run. Here the route is what is under
    // test, so the host's answers are supplied instead of probed.
    const real = require('../../src/infra/updater');
    mock.module(path.resolve(__dirname, '../../src/infra/updater.js'), {
      namedExports: {
        ...real,
        triggerState: () => state.trigger,
        lastStatus: () => state.last,
        requestPending: () => state.pending,
        requestUpdate: (ref) => { state.written.push(ref); return { ref }; },
      },
    });

    mock.module(path.resolve(__dirname, '../../src/infra/build-info.js'), {
      namedExports: {
        getBuildInfo: () => ({ version: '1.2.0', commit: 'abc1234', repository: 'rodacato/SheLLM' }),
        resetBuildInfo: () => {},
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  beforeEach(() => {
    state = { trigger: 'ready', last: null, pending: false, written: [] };
  });

  it('needs an admin session', async () => {
    await request(app).get('/admin/update').expect(401);
    await request(app).post('/admin/update').send({ ref: 'v1.3.0' }).expect(401);
  });

  it('reports the trigger state with the command that fixes it', async () => {
    state.trigger = 'not_installed';
    const res = await request(app).get('/admin/update').set('Authorization', `Basic ${adminCreds}`).expect(200);
    assert.equal(res.body.trigger, 'not_installed');
    assert.match(
      res.body.trigger_help,
      /vps\.sh/,
      'a host missing the units is fixed by re-provisioning, not by `systemctl enable`',
    );

    state.trigger = 'disabled';
    const off = await request(app).get('/admin/update').set('Authorization', `Basic ${adminCreds}`).expect(200);
    assert.match(off.body.trigger_help, /systemctl enable --now shellm-update\.path/);
  });

  it('refuses anything that is not a release tag', async () => {
    for (const ref of ['master', 'v1.2', '../../etc/passwd', 'v1.3.0; reboot', '', 42, undefined]) {
      const res = await post({ ref });
      assert.equal(res.status, 400, `${JSON.stringify(ref)} was accepted`);
    }
    assert.deepEqual(state.written, []);
  });

  it('refuses when the trigger is not armed, instead of writing a file nothing will read', async () => {
    state.trigger = 'disabled';
    const res = await post({ ref: 'v1.3.0' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'updater_unavailable');
    assert.deepEqual(state.written, []);
  });

  it('refuses a second request while one is still waiting or running', async () => {
    state.pending = true;
    assert.equal((await post({ ref: 'v1.3.0' })).body.error, 'update_pending');

    state.pending = false;
    state.last = { state: 'running', ref: 'v1.3.0', stalled: false };
    assert.equal((await post({ ref: 'v1.4.0' })).body.error, 'update_running');
    assert.deepEqual(state.written, []);
  });

  it('lets a request through once a stalled run is recognised as over', async () => {
    state.last = { state: 'running', ref: 'v1.3.0', stalled: true };
    await post({ ref: 'v1.3.0' }).expect(202);
    assert.deepEqual(state.written, ['v1.3.0']);
  });

  it('refuses a downgrade and says where rolling back is done', async () => {
    const res = await post({ ref: 'v1.1.1' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'not_an_upgrade');
    assert.match(res.body.message, /SHELLM_REF=v1\.1\.1 sudo shellm update/);
    assert.deepEqual(state.written, []);
  });

  it('refuses the version it already runs', async () => {
    assert.equal((await post({ ref: 'v1.2.0' })).body.error, 'not_an_upgrade');
  });

  it('makes a major jump be typed out', async () => {
    const res = await post({ ref: 'v2.0.0' });
    assert.equal(res.body.error, 'confirmation_required');
    assert.deepEqual(state.written, []);

    assert.equal((await post({ ref: 'v2.0.0', confirm: 'v1.9.9' })).status, 409);
    assert.deepEqual(state.written, [], 'confirming a different version is not confirming');

    await post({ ref: 'v2.0.0', confirm: 'v2.0.0' }).expect(202);
    assert.deepEqual(state.written, ['v2.0.0']);
  });

  it('does not ask for confirmation on a minor or patch', async () => {
    await post({ ref: 'v1.10.0' }).expect(202);
    assert.deepEqual(state.written, ['v1.10.0'], '1.10.0 is newer than 1.2.0, numerically');
  });

  it('records the request in the audit trail', async () => {
    await post({ ref: 'v1.3.0' }).expect(202);
    const { getAuditLogs } = require('../../src/db');
    const entry = getAuditLogs({ limit: 10 }).find((e) => e.resource === 'update');
    assert.ok(entry, 'a privileged action triggered from a browser has to leave a trace');
    assert.equal(entry.resource_id, 'v1.3.0');
  });
});
