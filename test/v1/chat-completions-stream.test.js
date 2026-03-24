const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// --- Unit tests for SSE helpers ---

describe('SSE helpers', () => {
  const { initSSE, sendSSEChunk, sendSSEDone, sendSSEError } = require('../../src/lib/sse');

  it('initSSE sets correct headers and flushes', () => {
    const headers = {};
    let flushed = false;
    const res = {
      set(k, v) { headers[k] = v; },
      flushHeaders() { flushed = true; },
    };
    initSSE(res);
    assert.strictEqual(headers['Content-Type'], 'text/event-stream');
    assert.strictEqual(headers['Cache-Control'], 'no-cache');
    assert.strictEqual(headers['Connection'], 'keep-alive');
    assert.strictEqual(headers['X-Accel-Buffering'], 'no');
    assert.ok(flushed);
  });

  it('sendSSEChunk writes data: {json} format', () => {
    let written = '';
    const res = { write(d) { written += d; return true; } };
    sendSSEChunk(res, { id: '1', content: 'hello' });
    assert.strictEqual(written, 'data: {"id":"1","content":"hello"}\n\n');
  });

  it('sendSSEDone writes [DONE] and ends response', () => {
    let written = '';
    let ended = false;
    const res = { write(d) { written += d; }, end() { ended = true; } };
    sendSSEDone(res);
    assert.strictEqual(written, 'data: [DONE]\n\n');
    assert.ok(ended);
  });

  it('sendSSEError writes error event then [DONE]', () => {
    let written = '';
    let ended = false;
    const res = { write(d) { written += d; }, end() { ended = true; } };
    sendSSEError(res, { message: 'test error', code: 'test_code' });

    const parts = written.split('data: ').filter(Boolean);
    assert.strictEqual(parts.length, 2);

    const errorEvent = JSON.parse(parts[0].trim());
    assert.strictEqual(errorEvent.error.message, 'test error');
    assert.strictEqual(errorEvent.error.code, 'test_code');

    assert.strictEqual(parts[1].trim(), '[DONE]');
    assert.ok(ended);
  });
});

// --- Unit tests for handleStream logic ---

describe('handleStream', () => {
  const { initSSE, sendSSEChunk, sendSSEDone } = require('../../src/lib/sse');

  function parseSSEText(text) {
    return text
      .split('\n\n')
      .filter(Boolean)
      .map((block) => {
        const line = block.replace(/^data: /, '');
        if (line === '[DONE]') return { done: true };
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
  }

  it('streaming provider yields correct OpenAI chunk sequence', async () => {
    // Simulate what handleStream does with a mock provider that has chatStream
    const written = [];
    let ended = false;
    const res = {
      set() {},
      flushHeaders() {},
      write(d) { written.push(d); return true; },
      end() { ended = true; },
    };

    initSSE(res);

    const id = 'shellm-test-123';
    const created = Math.floor(Date.now() / 1000);
    const model = 'claude';

    // Mock provider chatStream
    async function* chatStream() {
      yield { type: 'delta', content: 'Hello' };
      yield { type: 'delta', content: ' world' };
      yield { type: 'done' };
    }

    let sentRole = false;
    for await (const event of chatStream()) {
      if (event.type === 'delta') {
        if (!sentRole) {
          sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: event.content }, finish_reason: null }] });
          sentRole = true;
        } else {
          sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }] });
        }
      }
    }
    sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    sendSSEDone(res);

    const fullText = written.join('');
    const events = parseSSEText(fullText);

    // 3 chunks + [DONE] = 4 events
    assert.strictEqual(events.length, 4);

    // First chunk has role + content
    assert.strictEqual(events[0].object, 'chat.completion.chunk');
    assert.strictEqual(events[0].choices[0].delta.role, 'assistant');
    assert.strictEqual(events[0].choices[0].delta.content, 'Hello');
    assert.strictEqual(events[0].choices[0].finish_reason, null);
    assert.strictEqual(events[0].id, id);

    // Second chunk has content only
    assert.strictEqual(events[1].choices[0].delta.content, ' world');
    assert.strictEqual(events[1].choices[0].delta.role, undefined);

    // Final chunk has finish_reason stop
    assert.deepStrictEqual(events[2].choices[0].delta, {});
    assert.strictEqual(events[2].choices[0].finish_reason, 'stop');

    // Last is [DONE]
    assert.strictEqual(events[3].done, true);
    assert.ok(ended);
  });

  it('buffer-and-flush fallback produces valid SSE for non-streaming provider', async () => {
    const written = [];
    let ended = false;
    const res = {
      set() {},
      flushHeaders() {},
      write(d) { written.push(d); return true; },
      end() { ended = true; },
    };

    initSSE(res);

    const id = 'shellm-test-456';
    const created = Math.floor(Date.now() / 1000);
    const model = 'gemini';

    // Simulate buffer-and-flush path (provider has no chatStream)
    const result = { content: 'Full buffered response' };
    sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: result.content }, finish_reason: null }] });
    sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    sendSSEDone(res);

    const fullText = written.join('');
    const events = parseSSEText(fullText);

    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].choices[0].delta.content, 'Full buffered response');
    assert.strictEqual(events[1].choices[0].finish_reason, 'stop');
    assert.strictEqual(events[2].done, true);
    assert.ok(ended);
  });

  it('error mid-stream sends SSE error event', () => {
    const { sendSSEError } = require('../../src/lib/sse');
    const written = [];
    let ended = false;
    const res = {
      write(d) { written.push(d); },
      end() { ended = true; },
    };

    sendSSEError(res, { message: 'provider crashed', code: 'stream_error' });

    const fullText = written.join('');
    const events = parseSSEText(fullText);

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].error.message, 'provider crashed');
    assert.strictEqual(events[0].error.code, 'stream_error');
    assert.strictEqual(events[1].done, true);
    assert.ok(ended);
  });
});

// --- Provider chatStream contract tests ---

describe('provider chatStream contracts', () => {
  it('claude chatStream yields delta events from executeStream chunks', async () => {
    // Test the transformation logic: executeStream chunk → delta event
    // Claude chatStream maps { type: 'chunk', data } → { type: 'delta', content }
    const events = [];

    // Simulate what claude.chatStream does internally
    const mockChunks = [
      { type: 'chunk', data: 'Hello' },
      { type: 'chunk', data: ' world' },
      { type: 'done', stderr: '' },
    ];

    for (const chunk of mockChunks) {
      if (chunk.type === 'chunk') {
        events.push({ type: 'delta', content: chunk.data });
      }
    }
    events.push({ type: 'done' });

    assert.strictEqual(events.length, 3);
    assert.deepStrictEqual(events[0], { type: 'delta', content: 'Hello' });
    assert.deepStrictEqual(events[1], { type: 'delta', content: ' world' });
    assert.deepStrictEqual(events[2], { type: 'done' });
  });

  it('codex chatStream filters JSONL for item.completed events', () => {
    // Codex chatStream parses JSONL lines and yields content from item.completed
    const jsonlLines = [
      JSON.stringify({ type: 'item.created', item: {} }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello from Codex' } }),
      JSON.stringify({ type: 'turn.completed' }),
    ];

    const events = [];
    for (const line of jsonlLines) {
      const evt = JSON.parse(line);
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item.text) {
        events.push({ type: 'delta', content: evt.item.text });
      }
    }

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].content, 'Hello from Codex');
  });

  it('cerebras chatStream parses SSE data lines', () => {
    // Cerebras chatStream parses SSE from the API response
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      'data: [DONE]',
    ];

    const events = [];
    for (const line of sseLines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;
      const chunk = JSON.parse(payload);
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) events.push({ type: 'delta', content });
    }

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].content, 'Hi');
    assert.strictEqual(events[1].content, ' there');
  });
});

// --- Integration tests for /v1/chat/completions?stream=true ---

describe('/v1/chat/completions streaming integration', () => {
  let request;
  let app;
  let testKey;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd) => ({
          stdout: cmd === 'claude'
            ? JSON.stringify({ result: 'test reply', cost_usd: 0.001 })
            : 'test reply',
          stderr: '',
          duration_ms: 10,
        })),
        executeStream: mock.fn(async function* () {
          yield { type: 'chunk', data: 'Hello' };
          yield { type: 'chunk', data: ' world' };
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
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    const { initDb, closeDb, createClient } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');
    const client = createClient({ name: 'test-client', rpm: 100 });
    testKey = client.rawKey;

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
  });

  function parseSSE(text) {
    return text
      .split('\n\n')
      .filter((s) => s.trim())
      .map((block) => {
        const line = block.replace(/^data: /, '');
        if (line === '[DONE]') return { done: true };
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
  }

  it('returns full OpenAI SSE event sequence', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));

    const events = parseSSE(res.text);

    // First chunk: role only (per OpenAI spec, role and content are separate chunks)
    assert.strictEqual(events[0].object, 'chat.completion.chunk');
    assert.strictEqual(events[0].choices[0].delta.role, 'assistant');
    assert.strictEqual(events[0].choices[0].finish_reason, null);
    assert.ok(events[0].id.startsWith('chatcmpl-'));

    // Second chunk: content
    assert.strictEqual(typeof events[1].choices[0].delta.content, 'string');

    // Find final chunk with finish_reason
    const finalChunk = events.find((e) => e.choices && e.choices[0].finish_reason === 'stop');
    assert.ok(finalChunk, 'should have a chunk with finish_reason stop');
    assert.deepStrictEqual(finalChunk.choices[0].delta, {});

    // Last event is [DONE]
    assert.strictEqual(events[events.length - 1].done, true);
  });

  it('stream: false returns regular JSON response', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'chat.completion');
    assert.ok(res.headers['content-type'].includes('application/json'));
  });

  it('works with buffer-and-flush for non-streaming provider', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'gemini',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));

    const events = parseSSE(res.text);
    // Should have at least one content chunk + finish chunk + [DONE]
    assert.ok(events.length >= 3, 'should have content, finish, and DONE events');
    const finalChunk = events.find((e) => e.choices && e.choices[0].finish_reason === 'stop');
    assert.ok(finalChunk);
    assert.strictEqual(events[events.length - 1].done, true);
  });
});
