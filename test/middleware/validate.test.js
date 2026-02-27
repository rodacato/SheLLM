const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { validateCompletionRequest } = require('../../src/middleware/validate');

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  res.set = (key, val) => { res._headers[key] = val; return res; };
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

  it('rejects prompt exceeding 50000 characters', () => {
    const res = mockRes();
    const longPrompt = 'a'.repeat(50001);
    validateCompletionRequest({ body: { model: 'claude', prompt: longPrompt }, requestId: 'v-6' }, res, mock.fn());
    assert.strictEqual(res._status, 400);
    assert.match(res._body.message, /exceeds maximum length/);
    assert.match(res._body.message, /50001/);
  });

  it('accepts prompt at exactly 50000 characters', () => {
    const next = mock.fn();
    const exactPrompt = 'a'.repeat(50000);
    validateCompletionRequest({ body: { model: 'claude', prompt: exactPrompt }, requestId: 'v-7' }, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('rejects non-string system field', () => {
    const res = mockRes();
    validateCompletionRequest({ body: { model: 'claude', prompt: 'hi', system: 123 }, requestId: 'v-8' }, res, mock.fn());
    assert.strictEqual(res._status, 400);
    assert.match(res._body.message, /system/);
    assert.match(res._body.message, /string/);
  });

  it('accepts undefined system field', () => {
    const next = mock.fn();
    validateCompletionRequest({ body: { model: 'claude', prompt: 'hi' }, requestId: 'v-9' }, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('rejects invalid max_tokens values', () => {
    const cases = [
      { val: 'ten', desc: 'string' },
      { val: 0, desc: 'zero' },
      { val: -1, desc: 'negative' },
      { val: 3.5, desc: 'float' },
      { val: 128001, desc: 'above max' },
    ];

    for (const { val } of cases) {
      const res = mockRes();
      validateCompletionRequest(
        { body: { model: 'claude', prompt: 'hi', max_tokens: val }, requestId: 'v-mt' },
        res, mock.fn()
      );
      assert.strictEqual(res._status, 400, `expected 400 for max_tokens=${val}`);
      assert.match(res._body.message, /max_tokens/);
    }
  });

  it('accepts valid max_tokens values', () => {
    const validCases = [1, 100, 128000];
    for (const val of validCases) {
      const next = mock.fn();
      validateCompletionRequest(
        { body: { model: 'claude', prompt: 'hi', max_tokens: val }, requestId: 'v-mt-ok' },
        mockRes(), next
      );
      assert.strictEqual(next.mock.callCount(), 1, `expected next() for max_tokens=${val}`);
    }
  });
});
