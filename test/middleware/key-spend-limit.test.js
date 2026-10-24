'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ADMIN_PASSWORD = 'spend-limit-password';
process.env.SHELLM_ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.SHELLM_GLOBAL_RPM = '500';

const db = require('../../src/db');
const { monthStartUtc, toSqliteDatetime } = require('../../src/lib/time');

function logCost(clientId, { cost_usd = null, cost_estimate_usd = null, at = null } = {}) {
  db.insertRequestLog({ request_id: `r-${Math.random()}`, client_id: clientId, status: 200, cost_usd, cost_estimate_usd });
  if (at) db.getDb().prepare('UPDATE request_logs SET created_at = ? WHERE id = last_insert_rowid()').run(at);
}

describe('a key with a monthly spend limit', () => {
  let request;
  let app;

  before(() => {
    try { db.closeDb(); } catch { /* not open yet */ }
    db.initDb(':memory:');
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_GLOBAL_RPM;
    db.closeDb();
  });

  beforeEach(() => {
    db.getDb().exec('DELETE FROM request_logs; DELETE FROM clients;');
  });

  function models(key, headers = {}) {
    return request(app).get('/v1/models').set('Authorization', `Bearer ${key}`).set(headers);
  }

  it('answers while the month has spent less than the limit', async () => {
    const key = db.createClient({ name: 'fair-use', rpm: 100, spend_limit_usd: 100 });
    logCost(key.id, { cost_usd: 99.99 });
    await models(key.rawKey).expect(200);
  });

  it('refuses once reported and estimated cost together reach it, and tells the SDK not to retry', async () => {
    const key = db.createClient({ name: 'fair-use', rpm: 100, spend_limit_usd: 100 });
    logCost(key.id, { cost_usd: 60 });
    logCost(key.id, { cost_estimate_usd: 40 });

    const res = await models(key.rawKey).expect(429);

    assert.equal(res.body.error.code, 'spend_limit_exceeded');
    assert.equal(res.body.error.type, 'insufficient_quota');
    assert.equal(res.headers['x-should-retry'], 'false');
    const retryAfter = Number(res.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 31 * 24 * 3600, `retry-after reaches the next month: ${retryAfter}`);
  });

  it('speaks the Anthropic format to an Anthropic caller', async () => {
    const key = db.createClient({ name: 'fair-use', rpm: 100, spend_limit_usd: 1 });
    logCost(key.id, { cost_usd: 1 });

    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${key.rawKey}`)
      .send({ model: 'claude', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
      .expect(429);

    assert.equal(res.body.type, 'error');
    assert.equal(res.body.error.type, 'rate_limit_error');
  });

  it('starts every month from zero', async () => {
    const key = db.createClient({ name: 'fair-use', rpm: 100, spend_limit_usd: 100 });
    const lastSecondOfLastMonth = toSqliteDatetime(new Date(monthStartUtc().getTime() - 1000));
    logCost(key.id, { cost_usd: 500, at: lastSecondOfLastMonth });

    await models(key.rawKey).expect(200);
  });

  it('counts only its own key', async () => {
    const capped = db.createClient({ name: 'fair-use', rpm: 100, spend_limit_usd: 10 });
    const other = db.createClient({ name: 'other-app', rpm: 100, spend_limit_usd: 10 });
    logCost(other.id, { cost_usd: 50 });

    await models(capped.rawKey).expect(200);
  });

  it('never refuses a key without a limit, however much it spent', async () => {
    const key = db.createClient({ name: 'unlimited', rpm: 100 });
    logCost(key.id, { cost_usd: 10_000 });
    await models(key.rawKey).expect(200);
  });
});

describe('the admin API for a key spend limit', () => {
  let request;
  let app;
  let auth;

  before(() => {
    try { db.closeDb(); } catch { /* not open yet */ }
    db.initDb(':memory:');
    auth = `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64')}`;
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    db.closeDb();
  });

  function create(body) {
    return request(app).post('/admin/keys').set('Authorization', auth).send(body);
  }

  it('stores the limit and lists what the month has spent against it', async () => {
    const created = await create({ name: 'capped', spend_limit_usd: 100 }).expect(201);
    assert.equal(created.body.key.spend_limit_usd, 100);
    logCost(created.body.key.id, { cost_usd: 12.5 });
    logCost(created.body.key.id, { cost_estimate_usd: 2.5 });

    const listed = await request(app).get('/admin/keys').set('Authorization', auth).expect(200);
    const key = listed.body.keys.find((k) => k.name === 'capped');
    assert.equal(key.month_spend.spent_usd, 15);
    assert.ok(Date.parse(key.month_spend.resets_at) > Date.now());
  });

  it('reports no month spend for a key without a limit', async () => {
    await create({ name: 'open' }).expect(201);
    const listed = await request(app).get('/admin/keys').set('Authorization', auth).expect(200);
    assert.equal(listed.body.keys.find((k) => k.name === 'open').month_spend, null);
  });

  it('clears the limit when PATCHed with null', async () => {
    const created = await create({ name: 'was-capped', spend_limit_usd: 5 }).expect(201);
    const patched = await request(app)
      .patch(`/admin/keys/${created.body.key.id}`)
      .set('Authorization', auth)
      .send({ spend_limit_usd: null })
      .expect(200);
    assert.equal(patched.body.key.spend_limit_usd, null);
  });

  it('refuses a limit that is not a positive number, on create and on PATCH', async () => {
    for (const bad of [0, -5, '100']) {
      const res = await create({ name: `bad-${String(bad)}`, spend_limit_usd: bad }).expect(400);
      assert.match(res.body.message, /spend_limit_usd/);
    }
    const created = await create({ name: 'patch-target' }).expect(201);
    await request(app)
      .patch(`/admin/keys/${created.body.key.id}`)
      .set('Authorization', auth)
      .send({ spend_limit_usd: 'lots' })
      .expect(400);
  });
});
