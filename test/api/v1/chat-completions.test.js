const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/chat/completions', () => {
  let request;
  let app;
  let authHeader;

  before(() => {
    mock.module(path.resolve(__dirname, '../../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd, args) => ({
          stdout: cmd === 'claude'
            ? JSON.stringify(args.includes('--json-schema')
              ? { result: '{"ok":true}', structured_output: { ok: true } }
              : { result: 'test reply', cost_usd: 0.001 })
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

    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');
    const client = createClient({ name: 'test-client', rpm: 100 });
    authHeader = `Bearer ${client.rawKey}`;

    request = require('supertest');
    app = require('../../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../../src/db');
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

  it('hands reasoning_effort to the CLI, with minimal as its lowest level', async () => {
    const res = await post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning_effort: 'minimal',
    });

    assert.strictEqual(res.status, 200);
    const args = require('../../../src/providers/base.js').execute.mock.calls.at(-1).arguments[1];
    assert.strictEqual(args[args.indexOf('--effort') + 1], 'low');
  });

  it('runs minimal as low on codex too, whose default model refuses minimal', async () => {
    const res = await post({
      model: 'codex',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning_effort: 'minimal',
    });

    assert.strictEqual(res.status, 200);
    const args = require('../../../src/providers/base.js').execute.mock.calls.at(-1).arguments[1];
    assert.ok(args.includes('model_reasoning_effort="low"'), `codex got ${JSON.stringify(args)}`);
  });

  it('rejects a reasoning_effort OpenAI does not define, naming the ones it does', async () => {
    for (const reasoning_effort of ['extreme', 'toString', 3]) {
      const res = await post({ model: 'claude', messages: [{ role: 'user', content: 'hello' }], reasoning_effort });
      assert.strictEqual(res.status, 400, `accepted ${JSON.stringify(reasoning_effort)}`);
      assert.match(res.body.error.message, /reasoning_effort.*minimal, low, medium, high/);
    }
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

  // --- response_format ---

  describe('response_format', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    const withFormat = (response_format) => post({
      model: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
      response_format,
    });

    it('answers a json_schema request with the structured output as the message content', async () => {
      const res = await withFormat({ type: 'json_schema', json_schema: { name: 'check', strict: true, schema } });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(JSON.parse(res.body.choices[0].message.content), { ok: true });
    });

    it('still accepts json_object and text', async () => {
      assert.strictEqual((await withFormat({ type: 'json_object' })).status, 200);
      assert.strictEqual((await withFormat({ type: 'text' })).status, 200);
    });

    // Knotty falls back to json_object when a 400 names the field, so every refusal must.
    for (const [label, format] of [
      ['an unknown type', { type: 'xml' }],
      ['json_schema without its object', { type: 'json_schema' }],
      ['a name with spaces', { type: 'json_schema', json_schema: { name: 'my schema', schema } }],
      ['a missing name', { type: 'json_schema', json_schema: { schema } }],
      ['a schema that is not an object', { type: 'json_schema', json_schema: { name: 'x', schema: [] } }],
      ['a non-boolean strict', { type: 'json_schema', json_schema: { name: 'x', schema, strict: 'yes' } }],
    ]) {
      it(`rejects ${label} with a message naming response_format`, async () => {
        const res = await withFormat(format);
        assert.strictEqual(res.status, 400);
        assert.match(res.body.error.message, /response_format/);
      });
    }

    it('rejects a schema too large to pass to the CLI as one argument', async () => {
      const big = { type: 'object', description: 'x'.repeat(110 * 1024) };
      const res = await withFormat({ type: 'json_schema', json_schema: { name: 'big', schema: big } });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /response_format.*exceeds/);
    });
  });

  // --- Images ---

  describe('image_url parts', () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const png = `data:image/png;base64,${PNG}`;
    const image = (url) => ({ type: 'image_url', image_url: { url, detail: 'high' } });
    const withImages = (...blocks) => post({
      model: 'claude',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Front:' }, ...blocks] }],
    });

    function lastCall() {
      const { mock: calls } = require('../../../src/providers/base.js').execute;
      return calls.calls.at(-1).arguments;
    }

    function withEnv(name, value, fn) {
      process.env[name] = value;
      return fn().finally(() => { delete process.env[name]; });
    }

    it('sends a data: URL image to the CLI in its place among the text', async () => {
      const res = await withImages(image(png), { type: 'text', text: 'Inside:' }, image(png));
      assert.strictEqual(res.status, 200);

      const [, args, options] = lastCall();
      assert.ok(args.includes('--input-format'));
      const content = JSON.parse(options.input).message.content;
      assert.deepStrictEqual(content.map((b) => b.type), ['text', 'image', 'text', 'image']);
      assert.strictEqual(content[1].source.data, PNG);
      assert.strictEqual(content[1].source.media_type, 'image/png');
    });

    // Knotty drops its images and retries as text when a 400 names them, so every refusal must.
    for (const [label, url, why] of [
      ['a remote URL, which SheLLM would have to fetch', 'https://example.com/img.png', /data: URL/],
      ['an unsupported media type', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', /image\/jpeg/],
      ['base64 that is not base64', 'data:image/png;base64,not*base64', /base64/],
      ['a media type that does not match the bytes', `data:image/jpeg;base64,${PNG}`, /not image\/jpeg/],
    ]) {
      it(`rejects ${label}`, async () => {
        const res = await withImages(image(url));
        assert.strictEqual(res.status, 400);
        assert.match(res.body.error.message, /image/);
        assert.match(res.body.error.message, why);
      });
    }

    it('rejects an image_url part without a url', async () => {
      const res = await withImages({ type: 'image_url', image_url: {} });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /image_url/);
    });

    it('counts images across the whole request against SHELLM_MAX_IMAGES', () => withEnv('SHELLM_MAX_IMAGES', '2', async () => {
      const res = await post({
        model: 'claude',
        messages: [
          { role: 'user', content: [image(png), image(png)] },
          { role: 'assistant', content: 'Seen.' },
          { role: 'user', content: [image(png)] },
        ],
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /Too many images: the limit is 2/);
    }));

    it('turns images off with SHELLM_MAX_IMAGES=0', () => withEnv('SHELLM_MAX_IMAGES', '0', async () => {
      const res = await withImages(image(png));
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /image/);
    }));

    it('rejects an image larger than SHELLM_MAX_IMAGE_BYTES, in decoded bytes', () => withEnv('SHELLM_MAX_IMAGE_BYTES', '60', async () => {
      const res = await withImages(image(png));
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /image is 69 bytes, the limit is 60/);
    }));

    it('accepts an image only in a user message', async () => {
      const res = await post({
        model: 'claude',
        messages: [
          { role: 'system', content: [image(png)] },
          { role: 'user', content: 'hello' },
        ],
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /image is only accepted in a user message/);
    });

    it('streams a request with images', async () => {
      const res = await post({
        model: 'claude',
        stream: true,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Colour?' }, image(png)] }],
      });
      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
    });
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
  const { extractMessages } = require('../../../src/api/v1/chat-completions');

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

  it('keeps each image in its place when a multi-turn history is flattened', () => {
    const image = { type: 'image', number: 1, media_type: 'image/png', data: 'x' };
    const { prompt, parts } = extractMessages([
      { role: 'user', content: 'Front: [image 1]', parts: [{ type: 'text', text: 'Front: ' }, image] },
      { role: 'assistant', content: 'A shelf.' },
      { role: 'user', content: 'Make it taller.' },
    ]);
    assert.strictEqual(prompt, 'user: Front: [image 1]\nassistant: A shelf.\nuser: Make it taller.');
    assert.deepStrictEqual(parts, [
      { type: 'text', text: 'user: Front: ' },
      image,
      { type: 'text', text: '\nassistant: A shelf.\nuser: Make it taller.' },
    ]);
  });

  it('returns no parts for a text-only conversation', () => {
    assert.strictEqual(extractMessages([{ role: 'user', content: 'hello' }]).parts, null);
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
