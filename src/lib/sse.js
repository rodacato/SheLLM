'use strict';

/**
 * Server-Sent Events (SSE) response helpers.
 */

function initSSE(res) {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');
  res.set('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendSSEChunk(res, data) {
  return res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSSEDone(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendSSEError(res, error) {
  const payload = {
    error: {
      message: error.message || 'Internal error',
      type: 'server_error',
      code: error.code || 'stream_error',
    },
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  sendSSEDone(res);
}

module.exports = { initSSE, sendSSEChunk, sendSSEDone, sendSSEError };
