'use strict';

const { describe, it, mock, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const EventEmitter = require('node:events');

describe('logging middleware', () => {
  let requestLogger;
  let mockDebug, mockInfo, mockWarn, mockError;

  before(() => {
    mockDebug = mock.fn();
    mockInfo = mock.fn();
    mockWarn = mock.fn();
    mockError = mock.fn();

    mock.module(path.resolve(__dirname, '../../src/lib/logger.js'), {
      namedExports: {
        debug: mockDebug,
        info: mockInfo,
        warn: mockWarn,
        error: mockError,
      },
    });

    delete require.cache[require.resolve('../../src/middleware/logging')];
    ({ requestLogger } = require('../../src/middleware/logging'));
  });

  beforeEach(() => {
    mockDebug.mock.resetCalls();
    mockInfo.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();
  });

  function fireRequest(url, statusCode) {
    const req = { method: 'GET', url, requestId: 'req-1', clientName: null };
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.locals = { provider: null, model: null };
    const next = mock.fn();
    requestLogger(req, res, next);
    res.emit('finish');
    return { req, res, next };
  }

  it('calls next() immediately', () => {
    const { next } = fireRequest('/v1/chat/completions', 200);
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('logs /health requests at debug level', () => {
    fireRequest('/health', 200);

    assert.strictEqual(mockDebug.mock.callCount(), 1);
    assert.strictEqual(mockInfo.mock.callCount(), 0);

    const entry = mockDebug.mock.calls[0].arguments[0];
    assert.strictEqual(entry.event, 'request');
    assert.strictEqual(entry.url, '/health');
    assert.strictEqual(entry.status, 200);
  });

  it('logs normal 2xx requests at info level', () => {
    fireRequest('/v1/chat/completions', 200);

    assert.strictEqual(mockInfo.mock.callCount(), 1);
    assert.strictEqual(mockDebug.mock.callCount(), 0);

    const entry = mockInfo.mock.calls[0].arguments[0];
    assert.strictEqual(entry.event, 'request');
    assert.strictEqual(entry.method, 'GET');
    assert.strictEqual(entry.status, 200);
    assert.strictEqual(typeof entry.duration_ms, 'number');
    assert.strictEqual(entry.request_id, 'req-1');
  });

  it('logs 4xx responses at warn level', () => {
    fireRequest('/v1/chat/completions', 400);
    assert.strictEqual(mockWarn.mock.callCount(), 1);
    assert.strictEqual(mockWarn.mock.calls[0].arguments[0].status, 400);
  });

  it('logs 5xx responses at error level', () => {
    fireRequest('/v1/chat/completions', 503);
    assert.strictEqual(mockError.mock.callCount(), 1);
    assert.strictEqual(mockError.mock.calls[0].arguments[0].status, 503);
  });

  it('includes client name when present', () => {
    const req = { method: 'POST', url: '/v1/chat/completions', requestId: 'req-2', clientName: 'myapp' };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.locals = { provider: null, model: null };
    requestLogger(req, res, mock.fn());
    res.emit('finish');

    assert.strictEqual(mockInfo.mock.calls[0].arguments[0].client, 'myapp');
  });
});
