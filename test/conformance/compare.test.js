'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { diff, classify } = require('./compare');

const message = (extra = {}) => ({
  status: 200,
  header_names: ['content-type', 'request-id'],
  body: { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, ...extra },
});

describe('conformance diff', () => {
  it('finds nothing between two responses of the same shape whose text differs', () => {
    const other = message();
    other.body.content[0].text = 'Something else entirely';
    assert.deepEqual(diff('anthropic', message(), other), []);
  });

  it('reports a missing object once, at its top, not once per nested field', () => {
    const reference = message({ usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } });
    const missing = diff('anthropic', reference, message()).filter((d) => d.kind === 'missing');
    assert.deepEqual(missing.map((d) => d.path), ['usage.server_tool_use']);
  });

  it('compares values only on contract paths', () => {
    const capped = message({ stop_reason: 'max_tokens', id: 'msg_other' });
    const diffs = diff('anthropic', capped, message());
    assert.deepEqual(diffs.map((d) => [d.kind, d.path]), [['value', 'stop_reason']]);
  });

  it('reports a header the reference sends and SheLLM does not', () => {
    const shellm = { ...message(), header_names: ['content-type', 'x-request-id'] };
    const diffs = classify(diff('anthropic', message(), shellm), []);
    assert.deepEqual(diffs.map((d) => [d.kind, d.path, d.blocking]), [['header', 'request-id', true]]);
  });

  it('treats a field only SheLLM sends as information, not a failure', () => {
    const [extra] = classify(diff('anthropic', message(), message({ x_shellm: { queued_ms: 0 } })), []);
    assert.equal(extra.kind, 'extra');
    assert.equal(extra.blocking, false);
  });

  it('compares a stream by its event sequence and by each event kind', () => {
    const stream = (deltaUsage) => ({
      status: 200,
      header_names: ['content-type'],
      events: [
        { event: 'message_start', data: { type: 'message_start', message: { type: 'message' } } },
        { event: 'ping', data: { type: 'ping' } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } } },
        { event: 'message_delta', data: { type: 'message_delta', usage: deltaUsage } },
      ],
    });
    const reference = stream({ output_tokens: 2, service_tier: 'standard' });
    const shellm = stream({ output_tokens: 2 });
    shellm.events.splice(1, 1);

    const diffs = classify(diff('anthropic', reference, shellm), [{ path: 'usage.service_tier', reason: 'billing' }]);

    const sequence = diffs.find((d) => d.kind === 'sequence');
    assert.equal(sequence.reference, 'message_start → ping → content_block_delta → message_delta');
    assert.equal(sequence.blocking, true);
    const tier = diffs.find((d) => d.path === 'message_delta.usage.service_tier');
    assert.equal(tier.accepted, 'billing', 'an accepted body path also covers the same field inside an event');
    assert.equal(tier.blocking, false);
  });

  it('judges a success against an error by status alone, naming the reference error', () => {
    const rejected = { status: 400, header_names: [], body: { type: 'error', error: { type: 'invalid_request_error', message: 'content must be non-empty' } } };
    const diffs = diff('anthropic', rejected, message());
    assert.deepEqual(diffs, [{ kind: 'status', path: '(status)', reference: '400 invalid_request_error: content must be non-empty', actual: 200 }]);
  });

  it('never accepts a different kind than the one declared', () => {
    const capped = message({ stop_reason: 'max_tokens' });
    const [d] = classify(diff('anthropic', capped, message()), [{ path: 'stop_reason', kind: 'missing', reason: 'nope' }]);
    assert.equal(d.blocking, true);
  });
});
