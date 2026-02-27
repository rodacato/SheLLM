const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, sanitizeInput } = require('../../src/middleware/sanitize');

describe('sanitize', () => {
  it('sanitize() strips null bytes and normalizes line endings', () => {
    assert.strictEqual(sanitize('hello\0world'), 'helloworld');
    assert.strictEqual(sanitize('line1\r\nline2'), 'line1\nline2');
    assert.strictEqual(sanitize('a'.repeat(60000)).length, 60000); // no truncation — validation rejects oversized prompts
    assert.strictEqual(sanitize(123), '');
    assert.strictEqual(sanitize(null), '');
    assert.strictEqual(sanitize(''), '');
  });

  it('sanitizeInput middleware sanitizes prompt and system', () => {
    const req = { body: { prompt: 'test\0prompt', system: 'sys\r\ntem' } };
    const next = mock.fn();
    sanitizeInput(req, {}, next);
    assert.strictEqual(req.body.prompt, 'testprompt');
    assert.strictEqual(req.body.system, 'sys\ntem');
    assert.strictEqual(next.mock.callCount(), 1);
  });
});
