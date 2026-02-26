const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { validateCompletionRequest } = require('../../src/middleware/validate');

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

describe('validate', () => {
  it('rejects missing model and missing prompt', () => {
    const res1 = mockRes();
    validateCompletionRequest({ body: { prompt: 'hello' }, requestId: 'v-1' }, res1, mock.fn());
    assert.strictEqual(res1._status, 400);
    assert.match(res1._body.message, /model/);

    const res2 = mockRes();
    validateCompletionRequest({ body: { model: 'claude' }, requestId: 'v-2' }, res2, mock.fn());
    assert.strictEqual(res2._status, 400);
    assert.match(res2._body.message, /prompt/);
  });

  it('rejects non-string prompt, unknown model, and passes valid request', () => {
    const res3 = mockRes();
    validateCompletionRequest({ body: { model: 'claude', prompt: 123 }, requestId: 'v-3' }, res3, mock.fn());
    assert.strictEqual(res3._status, 400);
    assert.match(res3._body.message, /string/);

    const res4 = mockRes();
    validateCompletionRequest({ body: { model: 'gpt-4', prompt: 'hi' }, requestId: 'v-4' }, res4, mock.fn());
    assert.strictEqual(res4._status, 400);
    assert.match(res4._body.message, /Unknown model/i);

    // Valid request passes through
    const next = mock.fn();
    validateCompletionRequest({ body: { model: 'claude', prompt: 'hello' }, requestId: 'v-5' }, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
  });
});
