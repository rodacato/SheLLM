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
  // Ensure auth is disabled for e2e
  delete process.env.SHELLM_CLIENTS;
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

describe('e2e: providers', () => {
  it('GET /providers lists all available providers', async () => {
    const res = await request(app).get('/providers');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.providers));
    assert.ok(res.body.providers.length >= 4);
  });
});

describe('e2e: claude', { skip: !authenticated.claude && 'claude not authenticated' }, () => {
  it('POST /completions with claude returns content', async () => {
    const res = await request(app)
      .post('/completions')
      .send({
        model: 'claude',
        prompt: 'Respond with exactly one word: hello',
        system: 'Reply in one word only.',
        request_id: 'e2e-claude-001',
      })
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider, 'claude');
    assert.strictEqual(res.body.request_id, 'e2e-claude-001');
    assert.strictEqual(typeof res.body.content, 'string');
    assert.ok(res.body.content.length > 0, 'content should not be empty');
    assert.strictEqual(typeof res.body.duration_ms, 'number');
    console.log(`    claude replied: "${res.body.content}" (${res.body.duration_ms}ms)`);
  });
});

describe('e2e: gemini', { skip: !authenticated.gemini && 'gemini not authenticated' }, () => {
  it('POST /completions with gemini returns content', async () => {
    const res = await request(app)
      .post('/completions')
      .send({
        model: 'gemini',
        prompt: 'What is 2+2? Reply with just the number.',
        request_id: 'e2e-gemini-001',
      })
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider, 'gemini');
    assert.strictEqual(res.body.request_id, 'e2e-gemini-001');
    assert.strictEqual(typeof res.body.content, 'string');
    assert.ok(res.body.content.length > 0, 'content should not be empty');
    assert.strictEqual(typeof res.body.duration_ms, 'number');
    console.log(`    gemini replied: "${res.body.content.slice(0, 100)}" (${res.body.duration_ms}ms)`);
  });
});

describe('e2e: codex', { skip: !authenticated.codex && 'codex not authenticated' }, () => {
  it('POST /completions with codex returns content', async () => {
    const res = await request(app)
      .post('/completions')
      .send({
        model: 'codex',
        prompt: 'Say hello in Spanish. One word only.',
        request_id: 'e2e-codex-001',
      })
      .timeout(120000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider, 'codex');
    assert.strictEqual(res.body.request_id, 'e2e-codex-001');
    assert.strictEqual(typeof res.body.content, 'string');
    assert.ok(res.body.content.length > 0, 'content should not be empty');
    assert.strictEqual(typeof res.body.duration_ms, 'number');
    console.log(`    codex replied: "${res.body.content.slice(0, 100)}" (${res.body.duration_ms}ms)`);
  });
});

describe('e2e: cerebras', { skip: !authenticated.cerebras && 'cerebras not authenticated' }, () => {
  it('POST /completions with cerebras returns content', async () => {
    const res = await request(app)
      .post('/completions')
      .send({
        model: 'cerebras',
        prompt: 'What is 1+1? Reply with just the number.',
        request_id: 'e2e-cerebras-001',
      })
      .timeout(30000);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider, 'cerebras');
    assert.strictEqual(res.body.request_id, 'e2e-cerebras-001');
    assert.strictEqual(typeof res.body.content, 'string');
    assert.ok(res.body.content.length > 0, 'content should not be empty');
    assert.ok(res.body.usage, 'cerebras should return usage');
    assert.strictEqual(typeof res.body.duration_ms, 'number');
    console.log(`    cerebras replied: "${res.body.content.slice(0, 100)}" (${res.body.duration_ms}ms)`);
  });
});

describe('e2e: error contract', () => {
  it('unknown model returns 400 with correct shape', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'gpt-4', prompt: 'test', request_id: 'e2e-err-001' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
    assert.ok(res.body.message);
    assert.strictEqual(res.body.request_id, 'e2e-err-001');
  });

  it('missing prompt returns 400', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
    assert.match(res.body.message, /prompt/);
  });
});
