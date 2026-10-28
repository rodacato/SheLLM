/**
 * E2E tests — the real CLIs behind the real app, no fakes. Each provider test spends one request
 * of quota, so this is run by hand before a CLI pin moves, never in CI: npm run test:e2e
 *
 * A provider whose CLI is not installed and signed in is skipped, and says so.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TIMEOUT_MS = 120000;
const ready = {};
let request;
let app;
let db;
let key;

before(async () => {
  db = require('../../src/db');
  db.initDb(':memory:');
  key = db.createClient({ name: 'e2e', rpm: 100 }).rawKey;
  request = require('supertest');
  app = require('../../src/app');

  const { providers } = await require('../../src/infra/health').getHealthStatus();
  for (const [name, status] of Object.entries(providers)) {
    ready[name] = !!(status.installed && status.authenticated);
    console.log(`  ${name} ${status.version ?? '(no version)'}: ${ready[name] ? 'ready' : 'skipped'}`);
  }
});

after(() => db.closeDb());

const post = (url, body) => request(app).post(url).set('Authorization', `Bearer ${key}`).send(body).timeout(TIMEOUT_MS);
const ask = (text) => [{ role: 'user', content: text }];

function events(res) {
  return res.text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)));
}

describe('e2e: the catalog', () => {
  it('lists a model for every ready provider', async (t) => {
    const res = await request(app).get('/v1/models').set('Authorization', `Bearer ${key}`);
    assert.equal(res.status, 200);
    const ids = res.body.data.map((m) => m.id);
    for (const name of Object.keys(ready).filter((n) => ready[n])) {
      assert.ok(ids.some((id) => id === name || id.startsWith(`${name}-`)), `${name} missing from ${ids.join(', ')}`);
    }
    t.diagnostic(`${ids.length} models`);
  });
});

for (const provider of ['claude', 'codex']) {
  describe(`e2e: ${provider}`, () => {
    it('answers in the OpenAI shape, with usage', async (t) => {
      if (!ready[provider]) return t.skip(`${provider} not signed in`);
      const res = await post('/v1/chat/completions', { model: provider, messages: ask('Reply with the single word OK.') });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.choices[0].message.content, /\bOK\b/i);
      assert.ok(res.body.usage.prompt_tokens > 0 && res.body.usage.completion_tokens > 0, JSON.stringify(res.body.usage));
    });

    it('streams in the Anthropic shape, ending in message_stop', async (t) => {
      if (!ready[provider]) return t.skip(`${provider} not signed in`);
      const res = await post('/v1/messages', { model: provider, max_tokens: 50, stream: true, messages: ask('Reply with the single word OK.') });
      assert.equal(res.status, 200, res.text.slice(0, 300));
      const stream = events(res);
      const text = stream.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
      assert.match(text, /\bOK\b/i);
      assert.equal(stream.at(-1)?.type, 'message_stop', 'the stream ended without closing');
    });

    it('answers a model the CLI does not have with a 404, not a CLI failure', async (t) => {
      if (!ready[provider]) return t.skip(`${provider} not signed in`);
      const res = await post('/v1/chat/completions', { model: `${provider}-no-such-model-e2e`, messages: ask('ping') });
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'model_not_found');
    });
  });
}

describe('e2e: claude without a system prompt', () => {
  it('does not carry the CLI\'s own coding-agent prompt', async (t) => {
    if (!ready.claude) return t.skip('claude not signed in');
    const res = await post('/v1/chat/completions', { model: 'claude-haiku', messages: ask('Hello') });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.usage.prompt_tokens < 2000, `${res.body.usage.prompt_tokens} prompt tokens for "Hello"`);
  });
});

describe('e2e: the error contract', () => {
  it('refuses a model no provider serves with the OpenAI error shape', async () => {
    const res = await post('/v1/chat/completions', { model: 'gpt-4', messages: ask('test') });
    assert.ok(res.status >= 400 && res.status < 500, `${res.status}`);
    assert.equal(res.body.error.type, 'invalid_request_error');
  });

  it('refuses a request without messages', async () => {
    const res = await post('/v1/chat/completions', { model: 'claude' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /messages/);
  });
});
