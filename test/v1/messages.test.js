const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/messages', () => {
  let request;
  let app;
  let testKey;

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
        stripNonPrintable: (t) => t,
      },
    });

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    process.env.SHELLM_GLOBAL_RPM = '200';

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    const { initDb, closeDb, createClient } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');
    const client = createClient({ name: 'test-client', rpm: 100 });
    testKey = client.rawKey;

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
  });

  // --- Success cases ---

  it('returns Anthropic response shape for single user message', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
  });

  // --- Validation errors ---

  it('rejects missing model', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.type, 'error');
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /model/);
  });

  it('rejects missing max_tokens', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.type, 'error');
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /max_tokens/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', max_tokens: 1024 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects empty messages array', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', max_tokens: 1024, messages: [] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects messages without user role', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'gpt-4',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /Unknown model/);
  });

  it('accepts stream: true and returns SSE content-type', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    // Stream is accepted (not rejected); response uses SSE
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));
  });

  it('rejects non-text content block', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'a'.repeat(50001) }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });

  // --- Temperature / top_p validation ---

  it('rejects temperature above 1', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        temperature: 1.5,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /temperature/);
  });

  it('rejects negative temperature', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        temperature: -0.1,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /temperature/);
  });

  it('accepts valid temperature', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        temperature: 0.7,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  it('rejects top_p above 1', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        top_p: 1.5,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /top_p/);
  });

  it('accepts valid top_p', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  // --- System as array of text blocks ---

  it('accepts system as array of text blocks', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        system: [{ type: 'text', text: 'Be helpful.' }],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
  });

  it('accepts system as array with multiple blocks', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        system: [
          { type: 'text', text: 'Be helpful.' },
          { type: 'text', text: 'Be concise.' },
        ],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
  });

  it('rejects system array with non-text block', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        system: [{ type: 'image', source: {} }],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /system/);
  });

  // --- Extra fields passthrough ---

  it('ignores metadata field', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        metadata: { user_id: 'abc' },
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  it('ignores top_k field', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        top_k: 10,
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  it('ignores tools field', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  // --- stop_sequences validation ---

  it('accepts stop_sequences as array of strings', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stop_sequences: ['END', 'STOP'],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 200);
  });

  it('rejects stop_sequences as non-array', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stop_sequences: 'END',
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /stop_sequences/);
  });

  it('rejects stop_sequences with non-string element', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stop_sequences: [123],
        messages: [{ role: 'user', content: 'hello' }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /stop_sequences/);
  });

  // --- All errors use Anthropic format ---

  it('returns Anthropic error format for all errors', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
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
