'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'scrape-token-for-tests';

// Answers by what the prompt asks for, the way the real CLI reports each case on stdout.
const FAKE_CLAUDE = `#!/usr/bin/env node
const prompt = require('fs').readFileSync(0, 'utf8');
const result = (fields) => process.stdout.write(JSON.stringify({ type: 'result', ...fields }));
if (prompt.includes('SLOW')) setTimeout(() => {}, 60000);
else if (prompt.includes('LIMIT')) { result({ is_error: true, api_error_status: 429, result: 'usage limit reached' }); process.exit(1); }
else if (prompt.includes('FAIL')) { process.stderr.write('boom'); process.exit(2); }
else {
  const usage = { input_tokens: 11, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 7 };
  if (process.argv.includes('stream-json')) {
    const delta = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } };
    process.stdout.write(JSON.stringify(delta) + '\\n');
  }
  result({ is_error: false, result: 'hi', total_cost_usd: 0.0042, usage });
  process.stdout.write('\\n');
}
`;

describe('GET /metrics', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let request;
  let app;
  let authHeader;

  before(() => {
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;

    const { initDb, createClient } = require('../../src/db');
    initDb(':memory:');
    authHeader = `Bearer ${createClient({ name: 'metrics-client', rpm: 100 }).rawKey}`;
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.METRICS_TOKEN;
    delete process.env.TIMEOUT_MS;
    fs.rmSync(fakeBin, { recursive: true, force: true });
    require('../../src/db').closeDb();
  });

  beforeEach(() => {
    process.env.METRICS_TOKEN = TOKEN;
  });

  const scrape = () => request(app).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
  const chat = (content, model = 'claude') => request(app)
    .post('/v1/chat/completions')
    .set('Authorization', authHeader)
    .send({ model, messages: [{ role: 'user', content }] });

  function sample(text, name, labels) {
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    const line = text.split('\n').find((l) => l.startsWith(`${name}{`) && wanted.every((w) => l.includes(w)));
    return line === undefined ? undefined : Number(line.split(' ').pop());
  }

  it('answers 404 while METRICS_TOKEN is unset, like a route that does not exist', async () => {
    delete process.env.METRICS_TOKEN;
    const res = await request(app).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
  });

  it('answers 401 to a missing or wrong bearer token', async () => {
    const missing = await request(app).get('/metrics');
    const wrong = await request(app).get('/metrics').set('Authorization', `Bearer ${TOKEN}x`);
    const basic = await request(app).get('/metrics').set('Authorization', `Basic ${TOKEN}`);
    for (const res of [missing, wrong, basic]) {
      assert.equal(res.status, 401);
      assert.equal(res.headers['www-authenticate'], 'Bearer');
      assert.ok(!res.text.includes('process_cpu'), 'a refused scrape leaked metrics');
    }
  });

  it('answers 200 in the Prometheus text format with the right token', async () => {
    const res = await scrape();
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/plain; version=0\.0\.4/);
    assert.match(res.text, /^# TYPE process_cpu_user_seconds_total counter$/m);
    assert.match(res.text, /^# TYPE http_request_duration_seconds histogram$/m);
  });

  it('labels HTTP requests by route pattern, never by raw path, and leaves itself out', async () => {
    await request(app).get('/health');
    await request(app).get('/no/such/path/123');
    await request(app).delete('/admin/keys/42');
    const text = (await scrape()).text;

    assert.ok(sample(text, 'http_request_duration_seconds_count', { route: '/health', status_code: '200' }) >= 1);
    assert.ok(sample(text, 'http_request_duration_seconds_count', { route: 'unmatched', status_code: '404' }) >= 1);
    assert.ok(!text.includes('/no/such/path/123'));
    assert.ok(!text.includes('/admin/keys/42'));
    assert.equal(sample(text, 'http_request_duration_seconds_count', { route: '/metrics' }), undefined);
  });

  it('counts a completed CLI call with its tokens, cost and duration', async () => {
    const res = await chat('hello');
    assert.equal(res.status, 200);
    const text = (await scrape()).text;
    const labels = { provider: 'claude', model: 'claude' };

    assert.equal(sample(text, 'shellm_llm_requests_total', { ...labels, outcome: 'ok' }), 1);
    assert.equal(sample(text, 'shellm_llm_tokens_total', { ...labels, direction: 'input' }), 1011);
    assert.equal(sample(text, 'shellm_llm_tokens_total', { ...labels, direction: 'output' }), 7);
    assert.equal(sample(text, 'shellm_llm_cost_usd_total', labels), 0.0042);
    assert.equal(sample(text, 'shellm_llm_duration_seconds_count', labels), 1);
  });

  it('counts a streamed call in both formats once the stream has ended', async () => {
    const labels = { provider: 'claude', model: 'claude-sonnet' };
    const openai = await request(app).post('/v1/chat/completions').set('Authorization', authHeader)
      .send({ model: 'claude-sonnet', stream: true, messages: [{ role: 'user', content: 'hello' }] });
    const anthropic = await request(app).post('/v1/messages').set('Authorization', authHeader)
      .send({ model: 'claude-sonnet', stream: true, max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] });
    assert.ok(openai.text.includes('[DONE]'));
    assert.ok(anthropic.text.includes('message_stop'));
    const text = (await scrape()).text;

    assert.equal(sample(text, 'shellm_llm_requests_total', { ...labels, outcome: 'ok' }), 2);
    assert.equal(sample(text, 'shellm_llm_duration_seconds_count', labels), 2);
    assert.equal(sample(text, 'shellm_llm_tokens_total', { ...labels, direction: 'output' }), 14);
  });

  it('records each failure under its outcome', async () => {
    process.env.TIMEOUT_MS = '500';
    try {
      assert.equal((await chat('FAIL')).status, 502);
      assert.equal((await chat('LIMIT')).status, 429);
      assert.equal((await chat('SLOW')).status, 504);
    } finally {
      delete process.env.TIMEOUT_MS;
    }
    const text = (await scrape()).text;
    for (const outcome of ['error', 'rate_limited', 'timeout']) {
      assert.equal(sample(text, 'shellm_llm_requests_total', { provider: 'claude', model: 'claude', outcome }), 1, outcome);
    }
  });

  it('folds a model name the provider does not declare into "other"', async () => {
    await chat('hello', 'claude-anything-a-caller-typed');
    const text = (await scrape()).text;
    assert.equal(sample(text, 'shellm_llm_requests_total', { provider: 'claude', model: 'other', outcome: 'ok' }), 1);
    assert.ok(!text.includes('claude-anything-a-caller-typed'));
  });

  it('never carries a client name, key or prompt, and skips requests no CLI ran for', async () => {
    const before = sample((await scrape()).text, 'shellm_llm_requests_total', { provider: 'claude', model: 'claude', outcome: 'ok' });
    const refused = await request(app).post('/v1/chat/completions').set('Authorization', authHeader)
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }], stream_options: { include_usage: true } });
    assert.equal(refused.status, 400);
    const text = (await scrape()).text;

    assert.equal(sample(text, 'shellm_llm_requests_total', { provider: 'claude', model: 'claude', outcome: 'ok' }), before);
    assert.ok(!text.includes('metrics-client'));
    assert.ok(!text.includes(authHeader.slice('Bearer '.length)));
    assert.ok(!text.includes('hello'));
  });
});
