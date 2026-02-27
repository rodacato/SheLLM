const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/chat/completions', () => {
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

  it('returns OpenAI response shape for single user message', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.id.startsWith('shellm-'));
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.strictEqual(typeof res.body.created, 'number');
    assert.strictEqual(res.body.model, 'claude');

    // choices
    assert.strictEqual(res.body.choices.length, 1);
    assert.strictEqual(res.body.choices[0].index, 0);
    assert.strictEqual(res.body.choices[0].message.role, 'assistant');
    assert.strictEqual(typeof res.body.choices[0].message.content, 'string');
    assert.strictEqual(res.body.choices[0].finish_reason, 'stop');

    // usage
    assert.ok('usage' in res.body);
    assert.ok('prompt_tokens' in res.body.usage);
    assert.ok('completion_tokens' in res.body.usage);
    assert.ok('total_tokens' in res.body.usage);
  });

  it('extracts system message correctly', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'claude',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hello' },
        ],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.choices[0].message.role, 'assistant');
  });

  it('handles multi-turn conversation', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'claude',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
  });

  it('passes valid max_tokens through', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'claude',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      });

    assert.strictEqual(res.status, 200);
  });

  it('includes queue headers in response', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
  });

  // --- Error cases ---

  it('rejects missing model', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /model/);
  });

  it('rejects missing messages', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects empty messages array', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects messages without user role', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'system', content: 'test' }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /user/);
  });

  it('rejects messages with invalid shape', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user' }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /role.*content/);
  });

  it('rejects unknown model', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /Unknown model/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'claude',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: -5,
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /max_tokens/);
  });

  it('rejects prompt exceeding 50000 chars', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'claude',
        messages: [{ role: 'user', content: 'a'.repeat(50001) }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });
});

describe('extractMessages', () => {
  const { extractMessages } = require('../../src/v1/chat-completions');

  it('extracts system and single user message', () => {
    const { prompt, system } = extractMessages([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hello' },
    ]);

    assert.strictEqual(system, 'Be helpful');
    assert.strictEqual(prompt, 'Hello');
  });

  it('returns null system when no system message', () => {
    const { prompt, system } = extractMessages([
      { role: 'user', content: 'Hello' },
    ]);

    assert.strictEqual(system, null);
    assert.strictEqual(prompt, 'Hello');
  });

  it('concatenates multi-turn messages', () => {
    const { prompt, system } = extractMessages([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ]);

    assert.strictEqual(system, null);
    assert.match(prompt, /user: Hi/);
    assert.match(prompt, /assistant: Hello!/);
    assert.match(prompt, /user: How are you\?/);
  });
});
