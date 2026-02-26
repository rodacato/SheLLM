const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const cerebras = require('../../src/providers/cerebras');

describe('cerebras provider', () => {
  let savedKey;

  beforeEach(() => {
    savedKey = process.env.CEREBRAS_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.CEREBRAS_API_KEY = savedKey;
    } else {
      delete process.env.CEREBRAS_API_KEY;
    }
    mock.restoreAll();
  });

  it('chat() happy path with mocked fetch', async () => {
    process.env.CEREBRAS_API_KEY = 'test-key-123';

    mock.method(global, 'fetch', async (url, opts) => {
      // Verify correct URL and auth header
      assert.ok(url.includes('cerebras.ai'));
      assert.ok(opts.headers.Authorization.includes('test-key-123'));

      // Verify model mapping (cerebras -> gpt-oss-120b)
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.model, 'gpt-oss-120b');

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'cerebras reply' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
        }),
      };
    });

    const result = await cerebras.chat({ prompt: 'hello', model: 'cerebras' });
    assert.strictEqual(result.content, 'cerebras reply');
    assert.strictEqual(result.usage.input_tokens, 5);
    assert.strictEqual(result.usage.output_tokens, 10);
  });

  it('chat() throws when CEREBRAS_API_KEY missing', async () => {
    delete process.env.CEREBRAS_API_KEY;

    await assert.rejects(
      () => cerebras.chat({ prompt: 'test' }),
      (err) => {
        assert.strictEqual(err.provider_unavailable, true);
        return true;
      },
    );
  });

  it('chat() throws on non-ok response', async () => {
    process.env.CEREBRAS_API_KEY = 'test-key-123';

    mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    await assert.rejects(
      () => cerebras.chat({ prompt: 'test', model: 'cerebras' }),
      (err) => {
        assert.strictEqual(err.status, 429);
        return true;
      },
    );
  });
});
