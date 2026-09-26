const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The app, the baked catalog and the manifest are real. Only the CLI spawn is replaced, at the
// process boundary, so the arguments a request produces can be read back.
describe('the model catalog on /v1', () => {
  let request;
  let app;
  let key;
  let execute;

  before(() => {
    execute = mock.fn(async () => ({ stdout: JSON.stringify({ result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }), stderr: '', duration_ms: 1 }));
    mock.module(path.resolve(__dirname, '../../../src/providers/base.js'), {
      namedExports: { execute, stripNonPrintable: (t) => t },
    });
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    for (const k of Object.keys(require.cache)) {
      if (k.includes('/src/') || k.includes('dotenv')) delete require.cache[k];
    }
    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');
    key = createClient({ name: 'catalog-test', rpm: 100 }).rawKey;
    request = require('supertest');
    app = require('../../../src/server');
  });

  after(() => require('../../../src/db').closeDb());

  const models = async () => {
    const res = await request(app).get('/v1/models').set('Authorization', `Bearer ${key}`).expect(200);
    return new Map(res.body.data.map((m) => [m.id, m]));
  };

  const modelArg = () => {
    const args = execute.mock.calls.at(-1).arguments[1];
    return args[args.indexOf('--model') + 1];
  };

  describe('GET /v1/models', () => {
    it('reports each limit with where it came from: the CLI, the manifest, or the default', async () => {
      const fable = (await models()).get('claude-fable');
      assert.equal(fable.context_window, 200000);
      assert.equal(fable.context_window_1m, 1000000);
      assert.deepEqual(fable.x_shellm.sources, {
        context_window_1m: 'cli',
        context_window: 'manifest',
        reasoning_efforts: 'manifest',
        default_reasoning_effort: 'manifest',
      });
    });

    it('gives a model nobody describes the 200,000-token default, and says it is one', async () => {
      const bare = (await models()).get('claude');
      assert.equal(bare.context_window, 200000);
      assert.deepEqual(bare.x_shellm.sources, { context_window: 'default' });
    });

    it('offers no 1M window where the CLI lists no [1m] variant', async () => {
      assert.equal((await models()).get('claude-haiku').context_window_1m, undefined);
    });

    it('takes what codex reports about itself over anything written down', async () => {
      const astra = (await models()).get('codex-gpt-6-astra');
      assert.ok(astra.reasoning_efforts.includes('high'));
      assert.equal(astra.x_shellm.sources.reasoning_efforts, 'cli');
      assert.equal(astra.x_shellm.sources.context_window, 'default');
    });
  });

  describe('the context-1m beta header', () => {
    const chat = (model, beta) => {
      const req = request(app).post('/v1/chat/completions').set('Authorization', `Bearer ${key}`);
      if (beta) req.set('anthropic-beta', beta);
      return req.send({ model, messages: [{ role: 'user', content: 'hi' }] }).expect(200);
    };

    it('runs the model\'s 1M variant, whatever date the beta carries', async () => {
      await chat('claude-fable', 'context-1m-2025-08-07');
      assert.equal(modelArg(), 'fable[1m]');
      await chat('claude-sonnet', 'prompt-caching-2024-07-31, context-1m-2026-01-01');
      assert.equal(modelArg(), 'sonnet[1m]');
    });

    it('leaves the model as it was without the header', async () => {
      await chat('claude-fable');
      assert.equal(modelArg(), 'fable');
    });

    it('is ignored by a model with no 1M variant, as the API ignores it', async () => {
      await chat('claude-haiku', 'context-1m-2025-08-07');
      assert.equal(modelArg(), 'haiku');
    });

    it('works on /v1/messages the way the Anthropic SDK sends it', async () => {
      await request(app).post('/v1/messages').set('Authorization', `Bearer ${key}`)
        .set('anthropic-beta', 'context-1m-2025-08-07')
        .send({ model: 'claude-opus', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] })
        .expect(200);
      assert.equal(modelArg(), 'opus[1m]');
    });
  });
});
