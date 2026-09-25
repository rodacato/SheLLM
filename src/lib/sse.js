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

function sendSSEComment(res, text) {
  return res.write(`: ${text}\n\n`);
}

// A queued request has flushed its headers and written nothing yet. Comment lines say it is
// waiting rather than wedged, and keep an intermediary from timing the connection out. Both
// wire formats ignore a comment line, so this is shared.
function announceQueued(res, position, intervalMs = 3000) {
  const startedAt = Date.now();
  sendSSEComment(res, `queued position=${position}`);
  const timer = setInterval(() => {
    sendSSEComment(res, `queued position=${position} waiting_ms=${Date.now() - startedAt}`);
  }, intervalMs);
  return () => clearInterval(timer);
}

// Once a request leaves the queue nothing is written until the first token, and a model that
// thinks first can stay silent past 100 s — where Cloudflare's edge drops the connection.
const KEEPALIVE_MS = 15000;

function keepAlive(res, intervalMs = KEEPALIVE_MS) {
  const timer = setInterval(() => {
    if (!res.writableEnded) sendSSEComment(res, 'keepalive');
  }, intervalMs);
  const stop = () => clearInterval(timer);
  if (typeof res.on === 'function') res.on('close', stop);
  return stop;
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

module.exports = { initSSE, sendSSEComment, announceQueued, keepAlive, KEEPALIVE_MS, sendSSEChunk, sendSSEDone, sendSSEError };
