'use strict';

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('logger', () => {
  let savedLogLevel;
  let stdoutMock, stderrMock;

  function loadLogger(level) {
    if (level !== undefined) {
      process.env.LOG_LEVEL = level;
    } else {
      delete process.env.LOG_LEVEL;
    }
    delete require.cache[require.resolve('../../src/lib/logger')];
    return require('../../src/lib/logger');
  }

  function captureOutput() {
    stdoutMock = mock.method(process.stdout, 'write', () => true);
    stderrMock = mock.method(process.stderr, 'write', () => true);
  }

  beforeEach(() => {
    savedLogLevel = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (savedLogLevel !== undefined) {
      process.env.LOG_LEVEL = savedLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
    if (stdoutMock) { stdoutMock.mock.restore(); stdoutMock = null; }
    if (stderrMock) { stderrMock.mock.restore(); stderrMock = null; }
    delete require.cache[require.resolve('../../src/lib/logger')];
  });

  it('suppresses levels below LOG_LEVEL', () => {
    const logger = loadLogger('warn');
    captureOutput();

    logger.debug({ msg: 'hidden' });
    logger.info({ msg: 'hidden' });
    logger.warn({ msg: 'visible' });
    logger.error({ msg: 'visible' });

    assert.strictEqual(stdoutMock.mock.callCount(), 0);
    assert.strictEqual(stderrMock.mock.callCount(), 2);
  });

  it('outputs valid JSON with ts, level, and spread data', () => {
    const logger = loadLogger('debug');
    captureOutput();

    logger.info({ event: 'test', key: 'value' });

    const output = stdoutMock.mock.calls[0].arguments[0];
    const parsed = JSON.parse(output.trim());
    assert.strictEqual(parsed.level, 'info');
    assert.strictEqual(parsed.event, 'test');
    assert.strictEqual(parsed.key, 'value');
    assert.ok(parsed.ts);
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('routes debug/info to stdout and warn/error to stderr', () => {
    const logger = loadLogger('debug');
    captureOutput();

    logger.debug({ msg: 'd' });
    logger.info({ msg: 'i' });
    logger.warn({ msg: 'w' });
    logger.error({ msg: 'e' });

    assert.strictEqual(stdoutMock.mock.callCount(), 2);
    assert.strictEqual(stderrMock.mock.callCount(), 2);

    const debugOut = JSON.parse(stdoutMock.mock.calls[0].arguments[0]);
    const warnOut = JSON.parse(stderrMock.mock.calls[0].arguments[0]);
    assert.strictEqual(debugOut.level, 'debug');
    assert.strictEqual(warnOut.level, 'warn');
  });

  it('defaults to info when LOG_LEVEL is unset', () => {
    const logger = loadLogger(undefined);
    captureOutput();

    logger.debug({ msg: 'hidden' });
    logger.info({ msg: 'visible' });

    assert.strictEqual(stdoutMock.mock.callCount(), 1);
  });

  it('defaults to info for invalid LOG_LEVEL', () => {
    const logger = loadLogger('banana');
    captureOutput();

    logger.debug({ msg: 'hidden' });
    logger.info({ msg: 'visible' });

    assert.strictEqual(stdoutMock.mock.callCount(), 1);
  });
});
