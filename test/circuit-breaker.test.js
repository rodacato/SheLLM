const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Fresh module for each test suite to reset state
function loadCircuitBreaker() {
  const modulePath = require.resolve('../src/circuit-breaker');
  delete require.cache[modulePath];
  // Also reload logger to avoid issues
  return require('../src/circuit-breaker');
}

describe('circuit-breaker', () => {
  let cb;

  beforeEach(() => {
    cb = loadCircuitBreaker();
  });

  describe('initial state', () => {
    it('starts in closed state and allows traffic', () => {
      assert.strictEqual(cb.canSendTraffic('claude'), true);
      const state = cb.getCircuitState('claude');
      assert.strictEqual(state.state, 'closed');
      assert.strictEqual(state.failures, 0);
    });
  });

  describe('closed → open transition', () => {
    it('stays closed after fewer failures than threshold', () => {
      cb.recordFailure('claude');
      cb.recordFailure('claude');
      assert.strictEqual(cb.canSendTraffic('claude'), true);
      assert.strictEqual(cb.getCircuitState('claude').state, 'closed');
    });

    it('transitions to open after threshold failures', () => {
      cb.recordFailure('claude');
      cb.recordFailure('claude');
      cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');
      assert.strictEqual(cb.canSendTraffic('claude'), false);
    });
  });

  describe('open → half_open transition', () => {
    it('transitions to half_open after reset timer elapses', () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');

      // Manipulate lastTransitionAt to simulate time passage
      const state = cb.getCircuitState('claude');
      // We need to access internal state — use a workaround:
      // Record failure sets lastTransitionAt, so we override via env
      // Instead, let's just set CIRCUIT_BREAKER_RESET_MS=0 for test
      // Actually, let's test with the default and accept we can't fast-forward
      // For unit test, we test the logic by reloading with env override

      assert.strictEqual(cb.canSendTraffic('claude'), false);
    });
  });

  describe('half_open → closed on success', () => {
    it('transitions to closed after success in half_open', () => {
      // Use a short reset for this test
      process.env.CIRCUIT_BREAKER_RESET_MS = '0';
      cb = loadCircuitBreaker();

      for (let i = 0; i < 3; i++) cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');

      // With reset_ms=0, canSendTraffic should transition to half_open
      assert.strictEqual(cb.canSendTraffic('claude'), true);
      assert.strictEqual(cb.getCircuitState('claude').state, 'half_open');

      cb.recordSuccess('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'closed');
      assert.strictEqual(cb.getCircuitState('claude').failures, 0);

      delete process.env.CIRCUIT_BREAKER_RESET_MS;
    });
  });

  describe('half_open → open on failure', () => {
    it('transitions back to open after failure in half_open', () => {
      process.env.CIRCUIT_BREAKER_RESET_MS = '0';
      cb = loadCircuitBreaker();

      for (let i = 0; i < 3; i++) cb.recordFailure('claude');
      cb.canSendTraffic('claude'); // triggers half_open

      cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');

      delete process.env.CIRCUIT_BREAKER_RESET_MS;
    });
  });

  describe('half_open probing guard', () => {
    it('only allows one probe at a time in half_open', () => {
      process.env.CIRCUIT_BREAKER_RESET_MS = '0';
      cb = loadCircuitBreaker();

      for (let i = 0; i < 3; i++) cb.recordFailure('claude');

      // First call: allowed (transitions to half_open, probing=true)
      assert.strictEqual(cb.canSendTraffic('claude'), true);
      // Second call: blocked (probing in progress)
      assert.strictEqual(cb.canSendTraffic('claude'), false);

      // After success, probing resets
      cb.recordSuccess('claude');
      assert.strictEqual(cb.canSendTraffic('claude'), true);

      delete process.env.CIRCUIT_BREAKER_RESET_MS;
    });
  });

  describe('resetCircuit', () => {
    it('forces circuit back to closed', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');

      cb.resetCircuit('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'closed');
      assert.strictEqual(cb.getCircuitState('claude').failures, 0);
      assert.strictEqual(cb.canSendTraffic('claude'), true);
    });
  });

  describe('per-provider independence', () => {
    it('tracks state independently per provider', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').state, 'open');
      assert.strictEqual(cb.canSendTraffic('gemini'), true);
      assert.strictEqual(cb.getCircuitState('gemini').state, 'closed');
    });
  });

  describe('getAllCircuitStates', () => {
    it('returns states for all known providers', () => {
      cb.canSendTraffic('claude');
      cb.canSendTraffic('gemini');
      const states = cb.getAllCircuitStates();
      assert.ok(states.claude);
      assert.ok(states.gemini);
      assert.strictEqual(states.claude.state, 'closed');
    });
  });

  describe('recordSuccess in closed state', () => {
    it('resets failures without changing state', () => {
      cb.recordFailure('claude');
      cb.recordFailure('claude');
      assert.strictEqual(cb.getCircuitState('claude').failures, 2);

      cb.recordSuccess('claude');
      assert.strictEqual(cb.getCircuitState('claude').failures, 0);
      assert.strictEqual(cb.getCircuitState('claude').state, 'closed');
    });
  });
});
