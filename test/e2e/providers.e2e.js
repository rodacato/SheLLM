/**
 * E2E tests — real CLI calls, no mocks.
 * Run manually: npm run test:e2e
 * NOT included in CI (npm test).
 *
 * Skips providers that aren't authenticated.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

let app;
let authenticated = {};

before(async () => {
  app = require('../../src/server');

  // Check which providers are actually authenticated
  const res = await request(app).get('/health');
  const providers = res.body.providers || {};
  for (const [name, status] of Object.entries(providers)) {
    authenticated[name] = status.installed && status.authenticated;
  }

  console.log('\n  Provider status:');
  for (const [name, ready] of Object.entries(authenticated)) {
    console.log(`    ${name}: ${ready ? 'ready' : 'skipped'}`);
  }
  console.log('');
});

describe('e2e: health', () => {
  it('GET /health returns real provider statuses', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.providers);
    assert.ok(res.body.queue);
    assert.strictEqual(typeof res.body.uptime_seconds, 'number');
  });
});

describe('e2e: models', () => {
  it('GET /v1/models lists all available models', async () => {
    const res = await request(app).get('/v1/models');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'list');
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 4);
    for (const m of res.body.data) {
      assert.strictEqual(m.object, 'model');
      assert.strictEqual(m.owned_by, 'shellm');
    }
  });
});

function chatBody(model, prompt, extra = {}) {
  return { model, messages: [{ role: 'user', content: prompt }], ...extra };
}

describe('e2e: claude', { skip: !authenticated.claude && 'claude not authenticated' }, () => {
  it('POST /v1/chat/completions with claude returns OpenAI shape', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send(chatBody('claude', 'Respond with exactly one word: hello', {
        messages: [
          { role: 'system', content: 'Reply in one word only.' },
          { role: 'user', content: 'Respond with exactly one word: hello' },
        ],
      }))
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.ok(res.body.choices[0].message.content.length > 0);
    console.log(`    claude replied: "${res.body.choices[0].message.content}"`);
  });
});

describe('e2e: gemini', { skip: !authenticated.gemini && 'gemini not authenticated' }, () => {
  it('POST /v1/chat/completions with gemini returns content', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send(chatBody('gemini', 'What is 2+2? Reply with just the number.'))
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.ok(res.body.choices[0].message.content.length > 0);
    console.log(`    gemini replied: "${res.body.choices[0].message.content.slice(0, 100)}"`);
  });
});

describe('e2e: codex', { skip: !authenticated.codex && 'codex not authenticated' }, () => {
  it('POST /v1/chat/completions with codex returns content', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send(chatBody('codex', 'Say hello in Spanish. One word only.'))
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.ok(res.body.choices[0].message.content.length > 0);
    console.log(`    codex replied: "${res.body.choices[0].message.content.slice(0, 100)}"`);
  });
});

describe('e2e: cerebras', { skip: !authenticated.cerebras && 'cerebras not authenticated' }, () => {
  it('POST /v1/chat/completions with cerebras returns content and usage', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send(chatBody('cerebras', 'What is 1+1? Reply with just the number.'))
      .timeout(30000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.ok(res.body.choices[0].message.content.length > 0);
    assert.ok(res.body.usage, 'cerebras should return usage');
    console.log(`    cerebras replied: "${res.body.choices[0].message.content.slice(0, 100)}"`);
  });
});

describe('e2e: error contract', () => {
  it('unknown model returns 400 with OpenAI error shape', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.ok(res.body.error.message);
  });

  it('missing messages returns 400', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.match(res.body.error.message, /messages/);
  });
});
