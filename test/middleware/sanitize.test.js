const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitize } = require('../../src/middleware/sanitize');

describe('sanitize', () => {
  it('strips null bytes and normalizes line endings', () => {
    assert.strictEqual(sanitize('hello\0world'), 'helloworld');
    assert.strictEqual(sanitize('line1\r\nline2'), 'line1\nline2');
    assert.strictEqual(sanitize('a'.repeat(60000)).length, 60000); // no truncation — validation rejects oversized prompts
    assert.strictEqual(sanitize(123), '');
    assert.strictEqual(sanitize(null), '');
    assert.strictEqual(sanitize(''), '');
  });
});
