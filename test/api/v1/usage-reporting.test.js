'use strict';

const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function claudeStreamLines(...texts) {
  const deltas = texts.map((text) => JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  }));
  const result = JSON.stringify({
    type: 'result',
    total_cost_usd: 0.0042,
    usage: { input_tokens: 11, output_tokens: 7 },
  });
  return [...deltas, result].map((line) => `${line}\n`);
}

function parseSSE(text) {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice('data: '.length).trim())
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload));
}

function parseAnthropicSSE(text) {
  return text
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => JSON.parse(block.slice(block.indexOf('data: ') + 'data: '.length).trim()));
}

describe('what a benchmark can read back', () => {
  let request;
  let app;
  let authHeader;

  before(() => {
    mock.module(path.resolve(__dirname, '../../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: JSON.stringify({
            result: 'measured reply',
            total_cost_usd: 0.0042,
            usage: { input_tokens: 11, output_tokens: 7 },
          }),
          stderr: '',
          duration_ms: 10,
        })),
        executeStream: mock.fn(async function* () {
          for (const line of claudeStreamLines('mea', 'sured')) yield { type: 'chunk', data: line };
          yield { type: 'done', stderr: '' };
        }),
        stripNonPrintable: (t) => t,
      },
    });

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    process.env.SHELLM_GLOBAL_RPM = '200';

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* not open yet */ }
    initDb(':memory:');
    authHeader = `Bearer ${createClient({ name: 'bench-client', rpm: 100 }).rawKey}`;

    request = require('supertest');
    app = require('../../../src/server');
  });

  after(() => {
    require('../../../src/db').closeDb();
  });

  function chat(body) {
    return request(app).post('/v1/chat/completions').set('Authorization', authHeader).send(body);
  }

  function messages(body) {
    return request(app).post('/v1/messages').set('Authorization', authHeader).send(body);
  }

  const META_KEYS = ['cost_usd', 'queue_ms', 'cli_ms', 'ttft_ms'];

  it('puts the four numbers on a buffered OpenAI response', async () => {
    const res = await chat({ model: 'claude', messages: [{ role: 'user', content: 'hi' }] }).expect(200);

    assert.deepEqual(Object.keys(res.body.x_shellm).sort(), [...META_KEYS].sort());
    assert.equal(res.body.x_shellm.cost_usd, 0.0042);
    assert.equal(typeof res.body.x_shellm.queue_ms, 'number');
    assert.equal(typeof res.body.x_shellm.cli_ms, 'number');
    assert.ok(res.body.x_shellm.cli_ms >= 0);
  });

  it('puts the same block on a buffered Anthropic response', async () => {
    const res = await messages({ model: 'claude', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] }).expect(200);

    assert.deepEqual(Object.keys(res.body.x_shellm).sort(), [...META_KEYS].sort());
    assert.equal(res.body.x_shellm.cost_usd, 0.0042);
  });

  it('sends no usage chunk unless stream_options asks for one', async () => {
    const res = await chat({ model: 'claude', stream: true, messages: [{ role: 'user', content: 'hi' }] }).expect(200);
    const chunks = parseSSE(res.text);

    assert.equal(chunks.filter((c) => c.usage).length, 0);

    const last = chunks[chunks.length - 1];
    assert.equal(last.choices[0].finish_reason, 'stop');
    assert.deepEqual(Object.keys(last.x_shellm).sort(), [...META_KEYS].sort());
  });

  it('sends the usage chunk last when stream_options.include_usage is set', async () => {
    const res = await chat({
      model: 'claude',
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'hi' }],
    }).expect(200);

    const chunks = parseSSE(res.text);
    const usageChunk = chunks[chunks.length - 1];

    assert.deepEqual(usageChunk.choices, []);
    assert.equal(usageChunk.usage.prompt_tokens, 11);
    assert.equal(usageChunk.usage.completion_tokens, 7);
    assert.equal(usageChunk.usage.total_tokens, 18);
    assert.equal(usageChunk.x_shellm.cost_usd, 0.0042);
    assert.equal(typeof usageChunk.x_shellm.ttft_ms, 'number');

    // The finish chunk still comes before it, so a client reading finish_reason is unaffected.
    assert.equal(chunks[chunks.length - 2].choices[0].finish_reason, 'stop');
  });

  it('refuses stream_options on a request that is not streaming', async () => {
    const res = await chat({
      model: 'claude',
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'hi' }],
    }).expect(400);

    assert.match(res.body.error.message, /only be used when "stream" is true/);
  });

  it('refuses a stream_options that is not an object of booleans', async () => {
    await chat({
      model: 'claude',
      stream: true,
      stream_options: { include_usage: 'yes' },
      messages: [{ role: 'user', content: 'hi' }],
    }).expect(400);
  });

  it('reports usage in message_start and message_delta, with the block on the delta', async () => {
    const res = await messages({
      model: 'claude',
      max_tokens: 32,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    }).expect(200);

    const events = parseAnthropicSSE(res.text);
    const start = events.find((e) => e.type === 'message_start');
    const delta = events.find((e) => e.type === 'message_delta');

    assert.equal(typeof start.message.usage.input_tokens, 'number');
    assert.equal(start.message.usage.output_tokens, 0);

    assert.equal(delta.usage.output_tokens, 7);
    assert.equal(delta.usage.input_tokens, 11, 'the real input count should replace the estimate');
    assert.deepEqual(Object.keys(delta.x_shellm).sort(), [...META_KEYS].sort());
    assert.equal(delta.x_shellm.cost_usd, 0.0042);
  });
});
