'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

const MODELS = ['claude', 'claude-haiku', 'claude-sonnet', 'claude-opus'];

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  chunks.forEach((chunk) => res.write(chunk));
  res.end();
}

function apiError(res, pathname, status, code, message) {
  return pathname === '/v1/messages'
    ? json(res, status, { type: 'error', error: { type: code, message } })
    : json(res, status, { error: { message, type: code, code, param: null } });
}

function hasImageBlock(body) {
  return (body.messages || []).some(
    (m) => Array.isArray(m.content) && m.content.some((part) => part.type !== 'text'),
  );
}

function startFakeShellm() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const authorized = (req.headers.authorization || '').startsWith('Bearer ');

    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
    if (!authorized) return apiError(res, url.pathname, 401, 'auth_required', 'no key');
    if (url.pathname === '/v1/models') {
      return json(res, 200, {
        object: 'list',
        data: MODELS.map((id) => ({ id, object: 'model', created: 0, owned_by: 'shellm' })),
      });
    }
    if (url.pathname === '/v1/embeddings') return apiError(res, url.pathname, 404, 'not_found', 'no embeddings');

    const raw = await readBody(req);
    if (raw.length > 256 * 1024) return apiError(res, url.pathname, 413, 'invalid_request', 'payload too large');

    let body = {};
    try {
      body = JSON.parse(raw);
    } catch { return apiError(res, url.pathname, 400, 'invalid_request', 'bad json'); }

    if (!body.model) return apiError(res, url.pathname, 400, 'invalid_request', 'Missing required field: model');
    if (!MODELS.includes(body.model)) {
      return body.model.startsWith('claude')
        ? apiError(res, url.pathname, 404, 'model_not_found', 'unknown model')
        : apiError(res, url.pathname, 400, 'invalid_request', 'no provider owns it');
    }
    if (hasImageBlock(body)) {
      return apiError(res, url.pathname, 400, 'invalid_request', 'text blocks only');
    }

    const answer = body.response_format?.type === 'json_schema'
      ? JSON.stringify({ city: 'Colima', country: 'Mexico' })
      : 'pong';
    if (url.pathname === '/v1/chat/completions') {
      if (body.stream) {
        return sse(res, [
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'po' } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'ng' } }] })}\n\n`,
          'data: [DONE]\n\n',
        ]);
      }
      return json(res, 200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    if (url.pathname === '/v1/messages') {
      if (body.stream) {
        return sse(res, [
          'event: message_start\ndata: {}\n\n',
          `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } })}\n\n`,
          'event: message_stop\ndata: {}\n\n',
        ]);
      }
      return json(res, 200, {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: answer }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    return apiError(res, url.pathname, 404, 'not_found', 'no such route');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('measures latency and probes capabilities against a real server', async (t) => {
  const { server, port } = await startFakeShellm();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-bench-')), 'run.json');
  t.after(() => server.close());

  const { stdout } = await run(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'bench.js'),
    '--base', `http://127.0.0.1:${port}`,
    '--key', 'test-key',
    '--suite', 'all',
    '--iterations', '2',
    '--concurrency', '3',
    '--out', out,
  ], { encoding: 'utf8' });

  assert.match(stdout, /BENCH_RUN_COMPLETE/);

  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const verdict = (id) => report.probes.find((p) => p.id === id)?.verdict;

  assert.equal(verdict('models'), 'works');
  assert.equal(verdict('embeddings'), 'rejected');
  assert.equal(verdict('unknown-model'), 'rejected');
  assert.equal(verdict('unknown-claude-model'), 'rejected');
  assert.equal(verdict('json-schema'), 'works');
  assert.equal(verdict('images'), 'rejected');
  assert.equal(verdict('auth'), 'rejected');
  assert.equal(verdict('payload-limit'), 'rejected');
  assert.equal(verdict('stream-openai'), 'works');
  assert.equal(verdict('stream-anthropic'), 'works');
  assert.equal(verdict('error-format-4xx'), 'works', 'a faithful server passes the error-shape probe');
  assert.equal(verdict('error-format-401'), 'works', 'a faithful server passes the 401-shape probe');

  const row = (scenario, label) => report.records.find((r) => r.scenario === scenario && r.label.startsWith(label));
  assert.equal(row('model', 'claude-haiku').n, 2);
  assert.equal(row('model', 'claude-haiku').failed, 0);
  assert.ok(Number.isInteger(row('model', 'claude-haiku').median), 'a median is recorded');
  assert.ok(row('overhead', 'GET /health').median >= 0);
  assert.equal(row('concurrency', '3 parallel').n, 3);
  assert.ok(row('streaming', 'claude-haiku').ttfb_median >= 0, 'streaming records a time to first chunk');
  assert.ok(row('streaming', 'claude-haiku').ttft_median >= 0, 'streaming records a time to first token');
  assert.ok(row('streaming', 'claude-sonnet (stream, /v1/messages)').ttft_median >= 0, 'the Anthropic stream is measured too');
});

test('--only runs a single scenario, so a fix can be re-measured cheaply', async (t) => {
  const { server, port } = await startFakeShellm();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-bench-')), 'only.json');
  t.after(() => server.close());

  await run(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'bench.js'),
    '--base', `http://127.0.0.1:${port}`,
    '--key', 'test-key',
    '--suite', 'latency',
    '--only', 'streaming',
    '--iterations', '1',
    '--out', out,
  ], { encoding: 'utf8' });

  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual([...new Set(report.records.map((r) => r.scenario))], ['streaming']);
});

test('refuses to run without an API key', async () => {
  await assert.rejects(
    run(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'bench.js'),
      '--base', 'http://127.0.0.1:1',
      '--suite', 'latency',
    ], { encoding: 'utf8', env: { ...process.env, SHELLM_KEY: '' } }),
    (err) => err.code === 2 && /No API key/.test(err.stderr),
  );
});
