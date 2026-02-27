const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/messages', () => {
  let request;
  let app;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd) => ({
          stdout: cmd === 'claude'
            ? JSON.stringify({ result: 'test reply', cost_usd: 0.001 })
            : 'test reply',
          stderr: '',
          duration_ms: 10,
        })),
      },
    });

    delete process.env.SHELLM_CLIENTS;

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    request = require('supertest');
    app = require('../../src/server');
  });

  // --- Success cases ---

  it('returns Anthropic response shape for single user message', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.id.startsWith('msg_shellm-'));
    assert.strictEqual(res.body.type, 'message');
    assert.strictEqual(res.body.role, 'assistant');
    assert.strictEqual(res.body.model, 'claude');
    assert.strictEqual(res.body.stop_reason, 'end_turn');
    assert.strictEqual(res.body.stop_sequence, null);

    // content blocks
    assert.ok(Array.isArray(res.body.content));
    assert.strictEqual(res.body.content.length, 1);
    assert.strictEqual(res.body.content[0].type, 'text');
    assert.strictEqual(typeof res.body.content[0].text, 'string');

    // usage
    assert.ok('usage' in res.body);
    assert.ok('input_tokens' in res.body.usage);
    assert.ok('output_tokens' in res.body.usage);
  });

  it('handles system prompt (top-level) + user message', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
    assert.strictEqual(res.body.role, 'assistant');
  });

  it('handles multi-turn conversation', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
  });

  it('handles content as array of text blocks', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' },
          ],
        }],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
  });

  it('includes queue headers in response', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
  });

  // --- Validation errors ---

  it('rejects missing model', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.type, 'error');
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /model/);
  });

  it('rejects missing max_tokens', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.type, 'error');
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /max_tokens/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: -5,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /max_tokens/);
  });

  it('rejects missing messages', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ model: 'claude', max_tokens: 1024 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects empty messages array', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ model: 'claude', max_tokens: 1024, messages: [] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects messages without user role', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [{ role: 'assistant', content: 'test' }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /user/);
  });

  it('rejects unknown model', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'gpt-4',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /Unknown model/);
  });

  it('rejects stream: true', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /[Ss]treaming/);
  });

  it('rejects non-text content block', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }],
        }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /text/);
  });

  it('rejects prompt exceeding 50000 chars', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'a'.repeat(50001) }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });

  // --- All errors use Anthropic format ---

  it('returns Anthropic error format for all errors', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({ max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.body.type, 'error');
    assert.ok(res.body.error);
    assert.strictEqual(typeof res.body.error.type, 'string');
    assert.strictEqual(typeof res.body.error.message, 'string');
    // Should NOT have OpenAI-style error fields
    assert.strictEqual(res.body.error.code, undefined);
    assert.strictEqual(res.body.error.param, undefined);
  });
});

describe('extractContent', () => {
  const { extractContent } = require('../../src/v1/messages');

  it('returns string content as-is', () => {
    assert.strictEqual(extractContent('hello'), 'hello');
  });

  it('extracts text from single text block', () => {
    assert.strictEqual(extractContent([{ type: 'text', text: 'hello' }]), 'hello');
  });

  it('joins multiple text blocks with newline', () => {
    const result = extractContent([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);
    assert.strictEqual(result, 'hello\nworld');
  });

  it('rejects non-text block types', () => {
    const result = extractContent([{ type: 'image', source: {} }]);
    assert.ok(result.error);
    assert.match(result.error, /text/);
  });
});

describe('extractPrompt', () => {
  const { extractPrompt } = require('../../src/v1/messages');

  it('extracts single user message as prompt', () => {
    const { prompt, system } = extractPrompt(
      [{ role: 'user', content: 'Hello' }],
      null
    );
    assert.strictEqual(prompt, 'Hello');
    assert.strictEqual(system, null);
  });

  it('passes through top-level system prompt', () => {
    const { prompt, system } = extractPrompt(
      [{ role: 'user', content: 'Hello' }],
      'Be helpful'
    );
    assert.strictEqual(prompt, 'Hello');
    assert.strictEqual(system, 'Be helpful');
  });

  it('formats multi-turn messages', () => {
    const { prompt } = extractPrompt(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ],
      null
    );
    assert.match(prompt, /user: Hi/);
    assert.match(prompt, /assistant: Hello!/);
    assert.match(prompt, /user: How are you\?/);
  });

  it('handles content as array of text blocks', () => {
    const { prompt } = extractPrompt(
      [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      null
    );
    assert.strictEqual(prompt, 'hello');
  });
});
