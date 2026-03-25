const logger = require('../lib/logger');

const THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10);
const RESET_MS = parseInt(process.env.CIRCUIT_BREAKER_RESET_MS || '60000', 10);

// Per-provider state: { state, failures, lastFailureAt, lastTransitionAt, probing }
const circuits = {};

function getOrCreate(name) {
  if (!circuits[name]) {
    circuits[name] = {
      state: 'closed',
      failures: 0,
      lastFailureAt: null,
      lastTransitionAt: Date.now(),
      probing: false,
    };
  }
  return circuits[name];
}

function transition(name, circuit, newState) {
  const from = circuit.state;
  circuit.state = newState;
  circuit.lastTransitionAt = Date.now();
  logger.warn({ event: 'circuit_transition', provider: name, from, to: newState, failures: circuit.failures });
}

function recordSuccess(name) {
  const circuit = getOrCreate(name);
  if (circuit.state === 'half_open') {
    circuit.probing = false;
    transition(name, circuit, 'closed');
  }
  circuit.failures = 0;
}

function recordFailure(name) {
  const circuit = getOrCreate(name);
  circuit.failures++;
  circuit.lastFailureAt = Date.now();

  if (circuit.state === 'half_open') {
    circuit.probing = false;
    transition(name, circuit, 'open');
    return;
  }

  if (circuit.state === 'closed' && circuit.failures >= THRESHOLD) {
    transition(name, circuit, 'open');
  }
}

function canSendTraffic(name) {
  const circuit = getOrCreate(name);

  if (circuit.state === 'closed') return true;

  if (circuit.state === 'open') {
    const elapsed = Date.now() - circuit.lastTransitionAt;
    if (elapsed >= RESET_MS) {
      // Only allow one probe at a time
      if (circuit.probing) return false;
      transition(name, circuit, 'half_open');
      circuit.probing = true;
      return true;
    }
    return false;
  }

  // half_open — only one probe allowed
  if (circuit.probing) return false;
  circuit.probing = true;
  return true;
}

function getCircuitState(name) {
  const circuit = getOrCreate(name);
  return {
    state: circuit.state,
    failures: circuit.failures,
    lastFailureAt: circuit.lastFailureAt,
    lastTransitionAt: circuit.lastTransitionAt,
  };
}

function getAllCircuitStates() {
  const result = {};
  for (const name of Object.keys(circuits)) {
    result[name] = getCircuitState(name);
  }
  return result;
}

function resetCircuit(name) {
  const circuit = getOrCreate(name);
  circuit.failures = 0;
  circuit.probing = false;
  if (circuit.state !== 'closed') {
    transition(name, circuit, 'closed');
  }
}

module.exports = { recordSuccess, recordFailure, canSendTraffic, getCircuitState, getAllCircuitStates, resetCircuit };
