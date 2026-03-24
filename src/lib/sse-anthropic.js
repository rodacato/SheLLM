'use strict';

/**
 * Anthropic-format Server-Sent Events helpers.
 * Implements the streaming event sequence for /v1/messages.
 */

function sendEvent(res, eventType, data) {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendMessageStart(res, id, model, inputTokens) {
  sendEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens ?? 0, output_tokens: 0 },
    },
  });
}

function sendContentBlockStart(res, index) {
  sendEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  });
}

function sendContentBlockDelta(res, index, text) {
  sendEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  });
}

function sendContentBlockStop(res, index) {
  sendEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index,
  });
}

function sendMessageDelta(res, stopReason, outputTokens, ttftMs) {
  const data = {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
  if (ttftMs != null) data.shellm = { ttft_ms: ttftMs };
  sendEvent(res, 'message_delta', data);
}

function sendMessageStop(res) {
  sendEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function sendStreamError(res, error) {
  sendEvent(res, 'error', {
    type: 'error',
    error: { type: 'server_error', message: error.message || 'Internal error' },
  });
  sendMessageStop(res);
}

module.exports = {
  sendEvent,
  sendMessageStart,
  sendContentBlockStart,
  sendContentBlockDelta,
  sendContentBlockStop,
  sendMessageDelta,
  sendMessageStop,
  sendStreamError,
};
