const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sendEvent, sendMessageStart, sendContentBlockStart, sendContentBlockDelta,
  sendContentBlockStop, sendMessageDelta, sendMessageStop, sendStreamError,
} = require('../../src/lib/sse-anthropic');

function mockRes() {
  const chunks = [];
  let ended = false;
  return {
    write(data) { chunks.push(data); },
    end() { ended = true; },
    get chunks() { return chunks; },
    get ended() { return ended; },
    get lastEvent() {
      const raw = chunks[chunks.length - 1];
      const lines = raw.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      return {
        event: eventLine ? eventLine.slice(7) : null,
        data: dataLine ? JSON.parse(dataLine.slice(6)) : null,
      };
    },
  };
}

describe('sse-anthropic helpers', () => {
  it('sendEvent writes event: and data: lines', () => {
    const res = mockRes();
    sendEvent(res, 'test_event', { foo: 'bar' });
    assert.strictEqual(res.chunks.length, 1);
    assert.ok(res.chunks[0].startsWith('event: test_event\n'));
    assert.ok(res.chunks[0].includes('data: {"foo":"bar"}\n'));
    assert.ok(res.chunks[0].endsWith('\n\n'));
  });

  it('sendMessageStart emits message_start with correct shape', () => {
    const res = mockRes();
    sendMessageStart(res, 'msg_123', 'claude');
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'message_start');
    assert.strictEqual(data.type, 'message_start');
    assert.strictEqual(data.message.id, 'msg_123');
    assert.strictEqual(data.message.role, 'assistant');
    assert.strictEqual(data.message.model, 'claude');
    assert.deepStrictEqual(data.message.content, []);
    assert.strictEqual(data.message.stop_reason, null);
  });

  it('sendMessageStart accepts inputTokens parameter', () => {
    const res = mockRes();
    sendMessageStart(res, 'msg_456', 'claude', 150);
    const { data } = res.lastEvent;
    assert.strictEqual(data.message.usage.input_tokens, 150);
    assert.strictEqual(data.message.usage.output_tokens, 0);
  });

  it('sendMessageStart defaults input_tokens to 0 when omitted', () => {
    const res = mockRes();
    sendMessageStart(res, 'msg_789', 'claude');
    const { data } = res.lastEvent;
    assert.strictEqual(data.message.usage.input_tokens, 0);
  });

  it('sendContentBlockStart emits content_block_start', () => {
    const res = mockRes();
    sendContentBlockStart(res, 0);
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'content_block_start');
    assert.strictEqual(data.type, 'content_block_start');
    assert.strictEqual(data.index, 0);
    assert.strictEqual(data.content_block.type, 'text');
    assert.strictEqual(data.content_block.text, '');
  });

  it('sendContentBlockDelta emits text_delta', () => {
    const res = mockRes();
    sendContentBlockDelta(res, 0, 'hello');
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'content_block_delta');
    assert.strictEqual(data.type, 'content_block_delta');
    assert.strictEqual(data.index, 0);
    assert.strictEqual(data.delta.type, 'text_delta');
    assert.strictEqual(data.delta.text, 'hello');
  });

  it('sendContentBlockStop emits content_block_stop', () => {
    const res = mockRes();
    sendContentBlockStop(res, 0);
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'content_block_stop');
    assert.strictEqual(data.type, 'content_block_stop');
    assert.strictEqual(data.index, 0);
  });

  it('sendMessageDelta emits stop_reason and usage', () => {
    const res = mockRes();
    sendMessageDelta(res, 'end_turn', 42);
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'message_delta');
    assert.strictEqual(data.delta.stop_reason, 'end_turn');
    assert.strictEqual(data.delta.stop_sequence, null);
    assert.strictEqual(data.usage.output_tokens, 42);
  });

  it('sendMessageStop emits message_stop and ends response', () => {
    const res = mockRes();
    sendMessageStop(res);
    const { event, data } = res.lastEvent;
    assert.strictEqual(event, 'message_stop');
    assert.strictEqual(data.type, 'message_stop');
    assert.strictEqual(res.ended, true);
  });

  it('sendStreamError emits error event then message_stop', () => {
    const res = mockRes();
    sendStreamError(res, new Error('test failure'));
    assert.strictEqual(res.chunks.length, 2);
    // First chunk: error
    const errorLines = res.chunks[0].split('\n');
    assert.ok(errorLines[0].includes('error'));
    const errorData = JSON.parse(errorLines[1].slice(6));
    assert.strictEqual(errorData.type, 'error');
    assert.strictEqual(errorData.error.type, 'server_error');
    assert.strictEqual(errorData.error.message, 'test failure');
    // Second chunk: message_stop
    assert.ok(res.chunks[1].includes('message_stop'));
    assert.strictEqual(res.ended, true);
  });
});
