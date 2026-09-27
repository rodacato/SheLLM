'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startShellm, FAIL, STREAM_TEXT, RESULT_TEXT, RESULT_USAGE, STREAM_USAGE } = require('./shellm-server');

const PROMPT = [{ role: 'user', content: 'Count to five' }];
const TOOL = { type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } };

function promptTokens(usage) {
  return usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
}

describe('the official openai SDK against SheLLM', () => {
  let shellm;
  let OpenAI;
  let client;

  before(async () => {
    shellm = await startShellm();
    OpenAI = require('openai');
    client = new OpenAI({ baseURL: `${shellm.origin}/v1`, apiKey: shellm.apiKey, maxRetries: 0 });
  });

  after(() => shellm.stop());

  it('completes a buffered call with the usage OpenAI reports, cached tokens included', async () => {
    const completion = await client.chat.completions.create({ model: 'claude', messages: PROMPT });

    assert.equal(completion.object, 'chat.completion');
    assert.equal(completion.choices[0].message.content, RESULT_TEXT);
    assert.equal(completion.choices[0].finish_reason, 'stop');
    assert.strictEqual(completion.choices[0].logprobs, null);
    assert.strictEqual(completion.choices[0].message.refusal, null);
    assert.equal(completion.usage.prompt_tokens, promptTokens(RESULT_USAGE));
    assert.equal(completion.usage.prompt_tokens_details.cached_tokens, RESULT_USAGE.cache_read_input_tokens);
    assert.equal(completion.usage.completion_tokens, RESULT_USAGE.output_tokens);
    assert.equal(completion.usage.total_tokens, promptTokens(RESULT_USAGE) + RESULT_USAGE.output_tokens);
  });

  it('streams chunks the SDK iterates to the end, with the usage chunk last', async () => {
    const stream = await client.chat.completions.create({
      model: 'claude',
      messages: PROMPT,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = '';
    const finishReasons = [];
    let usage = null;
    for await (const chunk of stream) {
      for (const choice of chunk.choices) {
        text += choice.delta.content ?? '';
        if (choice.finish_reason) finishReasons.push(choice.finish_reason);
      }
      if (chunk.usage) usage = chunk.usage;
    }

    assert.equal(text, STREAM_TEXT);
    assert.deepEqual(finishReasons, ['stop']);
    assert.equal(usage.prompt_tokens, promptTokens(STREAM_USAGE));
    assert.equal(usage.prompt_tokens_details.cached_tokens, STREAM_USAGE.cache_read_input_tokens);
    assert.equal(usage.completion_tokens, STREAM_USAGE.output_tokens);
  });

  it('assembles a whole completion with the stream helper', async () => {
    const stream = client.chat.completions.stream({
      model: 'claude',
      messages: PROMPT,
      stream_options: { include_usage: true },
    });
    const completion = await stream.finalChatCompletion();

    assert.equal(completion.choices[0].message.role, 'assistant');
    assert.equal(completion.choices[0].message.content, STREAM_TEXT);
    assert.equal(completion.choices[0].finish_reason, 'stop');
    assert.equal(completion.usage.prompt_tokens_details.cached_tokens, STREAM_USAGE.cache_read_input_tokens);
  });

  it('surfaces the tools refusal as a BadRequestError carrying the param', async () => {
    const err = await client.chat.completions.create({ model: 'claude', messages: PROMPT, tools: [TOOL] })
      .then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.BadRequestError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 400);
    assert.equal(err.type, 'invalid_request_error');
    assert.equal(err.code, 'unsupported_parameter');
    assert.equal(err.param, 'tools');
    assert.match(err.message, /Function calling is not supported yet/);
  });

  it('surfaces the tools refusal on a streaming call before any chunk', async () => {
    const err = await client.chat.completions.create({ model: 'claude', messages: PROMPT, tools: [TOOL], stream: true })
      .then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.BadRequestError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.param, 'tools');
  });

  it('surfaces a wrong key as an AuthenticationError', async () => {
    const stranger = new OpenAI({ baseURL: `${shellm.origin}/v1`, apiKey: 'shellm-not-a-key', maxRetries: 0 });
    const err = await stranger.chat.completions.create({ model: 'claude', messages: PROMPT }).then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.AuthenticationError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 401);
    assert.equal(err.type, 'authentication_error');
  });

  it('surfaces an unknown model as a BadRequestError, not a parse failure', async () => {
    const err = await client.chat.completions.create({ model: 'gpt-4o', messages: PROMPT }).then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.BadRequestError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.match(err.message, /Unknown model: gpt-4o/);
  });

  it('surfaces a CLI crash on a buffered call as an InternalServerError', async () => {
    const err = await client.chat.completions.create({ model: 'claude', messages: [{ role: 'user', content: FAIL }] })
      .then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.InternalServerError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'cli_failed');
  });

  it('surfaces a CLI crash mid-stream as an APIError, not a parse failure', async () => {
    const stream = await client.chat.completions.create({ model: 'claude', messages: [{ role: 'user', content: FAIL }], stream: true });
    const err = await (async () => { for await (const chunk of stream) void chunk; })().then(() => null, (e) => e);

    assert.ok(err instanceof OpenAI.APIError, `got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.type, 'server_error');
    assert.equal(err.code, 'cli_failed');
    assert.match(err.message, /simulated CLI crash/);
  });

  it('lists the models through the SDK paginator', async () => {
    const ids = [];
    for await (const model of client.models.list()) ids.push(model.id);

    assert.ok(ids.includes('claude'), ids.join(', '));
  });
});
