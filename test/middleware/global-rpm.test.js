const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// The global budget is shared by every key, so a request one key's own limit refuses must not
// spend it: a noisy key would lock every other key out for the rest of the minute.
describe('global rate limit', () => {
  let createAuthMiddleware;
  let db;

  before(() => {
    process.env.SHELLM_GLOBAL_RPM = '10';
    db = require('../../src/db');
    db.initDb(':memory:');
    ({ createAuthMiddleware } = require('../../src/middleware/auth'));
  });

  after(() => {
    delete process.env.SHELLM_GLOBAL_RPM;
    db.closeDb();
  });

  function call(middleware, key) {
    const res = { statusCode: 200, body: null, set() { return res; } };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    let admitted = false;
    middleware({ headers: { authorization: `Bearer ${key}` }, requestId: 'r' }, res, () => { admitted = true; });
    return admitted ? 'admitted' : res.body.message;
  }

  it('counts only the requests it admitted', () => {
    const noisy = db.createClient({ name: 'noisy', rpm: 2 }).rawKey;
    const quiet = db.createClient({ name: 'quiet', rpm: 5 }).rawKey;
    const busy = db.createClient({ name: 'busy', rpm: 100 }).rawKey;
    const middleware = createAuthMiddleware();

    const noisyResults = Array.from({ length: 10 }, () => call(middleware, noisy));
    assert.equal(noisyResults.filter((r) => r === 'admitted').length, 2);
    assert.equal(call(middleware, quiet), 'admitted');

    const busyResults = Array.from({ length: 8 }, () => call(middleware, busy));
    assert.equal(busyResults.filter((r) => r === 'admitted').length, 10 - 3);
    assert.match(busyResults.at(-1), /Global rate limit exceeded/);
  });
});
