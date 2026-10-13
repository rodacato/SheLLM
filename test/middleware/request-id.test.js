const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { requestId } = require('../../src/middleware/request-id');

function mockRes() {
  const res = { headers: {} };
  res.set = (name, value) => { res.headers[name] = value; return res; };
  return res;
}

describe('request-id', () => {
  it('uses x-request-id header when present', () => {
    const req = { headers: { 'x-request-id': 'header-id-123' }, body: {} };
    const next = mock.fn();
    const res = mockRes();
    requestId(req, res, next);
    assert.strictEqual(req.requestId, 'header-id-123');
    assert.strictEqual(res.headers['x-request-id'], 'header-id-123', 'the caller gets it back to quote');
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('falls back to body.request_id then UUID', () => {
    // body fallback
    const req1 = { headers: {}, body: { request_id: 'body-id-456' } };
    requestId(req1, mockRes(), mock.fn());
    assert.strictEqual(req1.requestId, 'body-id-456');

    // UUID fallback
    const req2 = { headers: {}, body: {} };
    requestId(req2, mockRes(), mock.fn());
    assert.match(req2.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

// /v1/chat/completions parses its body after auth, so the id has to be picked up again there.
describe('request_id in the body, through the app', () => {
  let request;
  let app;
  let key;

  before(() => {
    const db = require('../../src/db');
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
    key = db.createClient({ name: 'request-id', rpm: 100 }).rawKey;
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => require('../../src/db').closeDb());

  for (const url of ['/v1/chat/completions', '/v1/messages']) {
    it(`is honored on ${url}`, async () => {
      const res = await request(app).post(url).set('Authorization', `Bearer ${key}`).send({ request_id: 'mine-1' });
      assert.strictEqual(res.headers['x-request-id'], 'mine-1');
    });
  }

  it('loses to the x-request-id header', async () => {
    const res = await request(app).post('/v1/chat/completions').set('Authorization', `Bearer ${key}`)
      .set('x-request-id', 'from-header').send({ request_id: 'mine-1' });
    assert.strictEqual(res.headers['x-request-id'], 'from-header');
  });
});
