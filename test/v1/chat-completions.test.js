const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/chat/completions', () => {
  let request;
  let app;
  let authHeader;

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
    authHeader = `Bearer ${client.rawKey}`;

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  function post(body) {
    return request(app)
      .post('/v1/chat/completions')
      .set('Authorization', authHeader)
      .send(body);
  }

  it('returns OpenAI response shape for single user message', async () => {
    const res = await post({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.id.startsWith('chatcmpl-'));
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.strictEqual(typeof res.body.created, 'number');
    assert.strictEqual(res.body.model, 'claude');

    assert.strictEqual(res.body.choices.length, 1);
    assert.strictEqual(res.body.choices[0].index, 0);
    assert.strictEqual(res.body.choices[0].message.role, 'assistant');
    assert.strictEqual(typeof res.body.choices[0].message.content, 'string');
    assert.strictEqual(res.body.choices[0].finish_reason, 'stop');

    assert.ok('usage' in res.body);
    assert.ok('prompt_tokens' in res.body.usage);
    assert.ok('completion_tokens' in res.body.usage);
    assert.ok('total_tokens' in res.body.usage);
  });

  it('extracts system message correctly', async () => {
    const res = await post({
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
    const res = await post({
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
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 100,
    });

    assert.strictEqual(res.status, 200);
  });

  it('includes queue headers in response', async () => {
    const res = await post({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
  });

  it('passes valid temperature through', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    });

    assert.strictEqual(res.status, 200);
  });

  it('rejects invalid temperature', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 3,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /temperature/);
  });

  // --- Error cases ---

  it('rejects missing model', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'hello' }] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /model/);
  });

  it('rejects missing messages', async () => {
    const res = await post({ model: 'claude' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects empty messages array', async () => {
    const res = await post({ model: 'claude', messages: [] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });

  it('rejects messages without user role', async () => {
    const res = await post({ model: 'claude', messages: [{ role: 'system', content: 'test' }] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /user/);
  });

  it('rejects messages with invalid shape', async () => {
    const res = await post({ model: 'claude', messages: [{ role: 'user' }] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /content/);
  });

  it('rejects unknown model', async () => {
    const res = await post({ model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /Unknown model/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: -5,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /max_tokens/);
  });

  it('rejects prompt exceeding 50000 chars', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'a'.repeat(50001) }],
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });

  // --- Content as array (OpenAI content parts) ---

  it('accepts content as array of text objects', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
  });

  it('accepts content as array with multiple text blocks', async () => {
    const res = await post({
      model: 'claude',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      }],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
  });

  it('rejects content array with non-text block type', async () => {
    const res = await post({
      model: 'claude',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'http://example.com/img.png' } }],
      }],
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /content/);
  });

  it('rejects content array with missing text field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: [{ type: 'text' }] }],
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /content/);
  });

  // --- Extra fields passthrough (Postel's principle) ---

  it('ignores n field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      n: 2,
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores seed field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      seed: 42,
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores user field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      user: 'test-user',
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores frequency_penalty field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      frequency_penalty: 0.5,
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores presence_penalty field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      presence_penalty: 0.5,
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores logprobs field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      logprobs: true,
    });
    assert.strictEqual(res.status, 200);
  });

  it('ignores tools field', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'f', parameters: {} } }],
    });
    assert.strictEqual(res.status, 200);
  });

  // --- stop field validation ---

  it('accepts stop as string', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      stop: '\n',
    });
    assert.strictEqual(res.status, 200);
  });

  it('accepts stop as array of strings', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      stop: ['END', 'STOP'],
    });
    assert.strictEqual(res.status, 200);
  });

  it('rejects stop array with more than 4 elements', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      stop: ['a', 'b', 'c', 'd', 'e'],
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /stop/);
  });

  it('rejects stop with non-string element', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      stop: [123],
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /stop/);
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
