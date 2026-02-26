const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { requestId } = require('../../src/middleware/request-id');

describe('request-id', () => {
  it('uses x-request-id header when present', () => {
    const req = { headers: { 'x-request-id': 'header-id-123' }, body: {} };
    const next = mock.fn();
    requestId(req, {}, next);
    assert.strictEqual(req.requestId, 'header-id-123');
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('falls back to body.request_id then UUID', () => {
    // body fallback
    const req1 = { headers: {}, body: { request_id: 'body-id-456' } };
    requestId(req1, {}, mock.fn());
    assert.strictEqual(req1.requestId, 'body-id-456');

    // UUID fallback
    const req2 = { headers: {}, body: {} };
    requestId(req2, {}, mock.fn());
    assert.match(req2.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
