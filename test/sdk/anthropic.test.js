'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startShellm, FAIL, STREAM_TEXT, RESULT_TEXT, RESULT_USAGE, STREAM_USAGE } = require('./shellm-server');

const PROMPT = [{ role: 'user', content: 'Count to five' }];
const TOOL = { name: 'get_weather', description: 'Get the weather', input_schema: { type: 'object', properties: {} } };

describe('the official Anthropic SDK against SheLLM', () => {
  let shellm;
  let Anthropic;
  let client;

  before(async () => {
    shellm = await startShellm();
    Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ baseURL: shellm.origin, apiKey: shellm.apiKey, maxRetries: 0 });
  });

  after(() => shellm.stop());

  it('completes a buffered call with the usage Anthropic reports, cache counters included', async () => {
    const message = await client.messages.create({ model: 'claude', max_tokens: 1024, messages: PROMPT });

    assert.equal(message.type, 'message');
    assert.equal(message.role, 'assistant');
    assert.deepEqual(message.content, [{ type: 'text', text: RESULT_TEXT }]);
    assert.equal(message.stop_reason, 'end_turn');
    assert.strictEqual(message.stop_details, null, 'the SDK types stop_details as nullable, never absent');
    assert.strictEqual(message.container, null);
    assert.equal(message.usage.input_tokens, RESULT_USAGE.input_tokens);
    assert.equal(message.usage.cache_creation_input_tokens, RESULT_USAGE.cache_creation_input_tokens);
    assert.equal(message.usage.cache_read_input_tokens, RESULT_USAGE.cache_read_input_tokens);
    assert.equal(message.usage.output_tokens, RESULT_USAGE.output_tokens);
  });

  it('streams raw events the SDK iterates in the protocol order', async () => {
    const stream = await client.messages.create({ model: 'claude', max_tokens: 1024, messages: PROMPT, stream: true });

    const types = [];
    let text = '';
    for await (const event of stream) {
      types.push(event.type);
      if (event.type === 'content_block_delta') text += event.delta.text;
    }

    assert.equal(text, STREAM_TEXT);
    assert.equal(types[0], 'message_start');
    assert.equal(types[1], 'content_block_start');
    assert.deepEqual(types.slice(-3), ['content_block_stop', 'message_delta', 'message_stop']);
  });

  it('assembles the final message with the stream helper, real usage replacing the estimate', async () => {
    const stream = client.messages.stream({ model: 'claude', max_tokens: 1024, messages: PROMPT });
    const message = await stream.finalMessage();

    assert.deepEqual(message.content, [{ type: 'text', text: STREAM_TEXT }]);
    assert.equal(message.stop_reason, 'end_turn');
    assert.strictEqual(message.stop_sequence, null);
    assert.strictEqual(message.stop_details, null, 'the helper copies stop_details from message_delta');
    assert.strictEqual(message.container, null);
    assert.equal(message.usage.input_tokens, STREAM_USAGE.input_tokens);
    assert.equal(message.usage.cache_creation_input_tokens, STREAM_USAGE.cache_creation_input_tokens);
    assert.equal(message.usage.cache_read_input_tokens, STREAM_USAGE.cache_read_input_tokens);
    assert.equal(message.usage.output_tokens, STREAM_USAGE.output_tokens);
    assert.equal(await stream.finalText(), STREAM_TEXT);
  });

  it('surfaces the tools refusal as a BadRequestError', async () => {
    const err = await client.messages.create({ model: 'claude', max_tokens: 1024, messages: PROMPT, tools: [TOOL] })
      .then(() => null, (e) => e);

    assert.ok(err instanceof Anthropic.BadRequestError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 400);
    assert.equal(err.type, 'invalid_request_error');
    assert.match(err.error.error.message, /Function calling is not supported yet/);
  });

  it('surfaces the tools refusal from the stream helper', async () => {
    const stream = client.messages.stream({ model: 'claude', max_tokens: 1024, messages: PROMPT, tools: [TOOL] });
    const err = await stream.finalMessage().then(() => null, (e) => e);

    assert.ok(err instanceof Anthropic.BadRequestError, `got ${err?.constructor?.name}: ${err?.message}`);
  });

  it('surfaces a wrong key, sent as x-api-key, as an AuthenticationError', async () => {
    const stranger = new Anthropic({ baseURL: shellm.origin, apiKey: 'shellm-not-a-key', maxRetries: 0 });
    const err = await stranger.messages.create({ model: 'claude', max_tokens: 1024, messages: PROMPT }).then(() => null, (e) => e);

    assert.ok(err instanceof Anthropic.AuthenticationError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 401);
    assert.equal(err.type, 'authentication_error');
  });

  it('surfaces a CLI crash on a buffered call as an InternalServerError', async () => {
    const err = await client.messages.create({ model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: FAIL }] })
      .then(() => null, (e) => e);

    assert.ok(err instanceof Anthropic.InternalServerError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 502);
    assert.equal(err.type, 'api_error');
  });

  it('surfaces a CLI crash mid-stream as an APIError with an Anthropic error type', async () => {
    const stream = client.messages.stream({ model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: FAIL }] });
    const err = await stream.finalMessage().then(() => null, (e) => e);

    assert.ok(err instanceof Anthropic.APIError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.type, 'api_error');
    assert.match(err.message, /simulated CLI crash/);
  });
});
