const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/messages streaming', () => {
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
        executeStream: mock.fn(async function* (cmd, args, { signal: _signal } = {}) {
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
    const events = [];
    const rawEvents = text.split('\n\n').filter((s) => s.trim());
    for (const raw of rawEvents) {
      const lines = raw.split('\n');
      const event = {};
      for (const line of lines) {
        if (line.startsWith('event: ')) event.event = line.slice(7);
        if (line.startsWith('data: ')) {
          try { event.data = JSON.parse(line.slice(6)); } catch { event.data = line.slice(6); }
        }
      }
      if (Object.keys(event).length > 0) events.push(event);
    }
    return events;
  }

  it('returns full Anthropic SSE event sequence', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));

    const events = parseSSE(res.text);

    // First event: message_start
    assert.strictEqual(events[0].event, 'message_start');
    assert.strictEqual(events[0].data.type, 'message_start');
    assert.strictEqual(events[0].data.message.role, 'assistant');
    assert.ok(events[0].data.message.id.startsWith('msg_shellm-'));

    // Second event: content_block_start
    assert.strictEqual(events[1].event, 'content_block_start');
    assert.strictEqual(events[1].data.index, 0);

    // Delta events: content_block_delta with text
    const deltas = events.filter((e) => e.event === 'content_block_delta');
    assert.ok(deltas.length >= 1, 'should have at least one delta');
    for (const d of deltas) {
      assert.strictEqual(d.data.delta.type, 'text_delta');
      assert.strictEqual(typeof d.data.delta.text, 'string');
    }

    // content_block_stop
    const blockStop = events.find((e) => e.event === 'content_block_stop');
    assert.ok(blockStop);
    assert.strictEqual(blockStop.data.index, 0);

    // message_delta
    const msgDelta = events.find((e) => e.event === 'message_delta');
    assert.ok(msgDelta);
    assert.strictEqual(msgDelta.data.delta.stop_reason, 'end_turn');

    // message_stop (last event)
    const msgStop = events.find((e) => e.event === 'message_stop');
    assert.ok(msgStop);
    assert.strictEqual(msgStop.data.type, 'message_stop');
  });

  it('works with buffer-and-flush for non-streaming providers', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'gemini',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));

    const events = parseSSE(res.text);
    // Should still have the full event sequence
    assert.strictEqual(events[0].event, 'message_start');
    const deltas = events.filter((e) => e.event === 'content_block_delta');
    assert.ok(deltas.length >= 1, 'should have at least one delta');
    const msgStop = events.find((e) => e.event === 'message_stop');
    assert.ok(msgStop);
  });

  it('stream: false returns regular JSON response', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({
        model: 'claude',
        max_tokens: 1024,
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'message');
    assert.ok(res.headers['content-type'].includes('application/json'));
  });
});
