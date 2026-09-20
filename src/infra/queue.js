const { rateLimited } = require('../errors');
const logger = require('../lib/logger');

function getMaxConcurrent() {
  return parseInt(process.env.MAX_CONCURRENT || '2', 10);
}
function getMaxQueueDepth() {
  return parseInt(process.env.MAX_QUEUE_DEPTH || '10', 10);
}

// A count says how many are running; it cannot say that three of them have been running for nine
// minutes. Requests here are CLI subprocesses measured in seconds, so a wedged one is this
// product's characteristic failure and the age is the whole diagnosis.
const MAX_REPORTED_IN_FLIGHT = 10;

class RequestQueue {
  constructor(now = () => Date.now()) {
    this.running = new Map();
    this.pending = [];
    this.now = now;
    this.nextId = 1;
  }

  get active() {
    return this.running.size;
  }

  async enqueue(fn, label = null) {
    if (this.pending.length >= getMaxQueueDepth()) {
      logger.warn({ event: 'queue_full', active: this.active, pending: this.pending.length });
      throw rateLimited('Queue is full, try again later');
    }

    if (this.active >= getMaxConcurrent()) {
      await new Promise((resolve) => this.pending.push(resolve));
    }

    const id = this.nextId++;
    this.running.set(id, { startedAt: this.now(), label });
    logger.debug({ event: 'queue_dequeue', active: this.active, pending: this.pending.length });
    try {
      return await fn();
    } finally {
      this.running.delete(id);
      if (this.pending.length > 0) {
        const next = this.pending.shift();
        next();
      }
    }
  }

  // Oldest first: the one worth looking at is the one that has been running longest.
  get inFlight() {
    const at = this.now();
    return [...this.running.values()]
      .map((job) => ({ age_ms: at - job.startedAt, label: job.label }))
      .sort((a, b) => b.age_ms - a.age_ms)
      .slice(0, MAX_REPORTED_IN_FLIGHT);
  }

  get stats() {
    const { activeStreams, MAX_STREAM_CONCURRENT } = require('./stream-slots');
    const inFlight = this.inFlight;
    return {
      pending: this.pending.length,
      active: this.active,
      max_concurrent: getMaxConcurrent(),
      active_streams: activeStreams(),
      max_stream_concurrent: MAX_STREAM_CONCURRENT,
      in_flight: inFlight,
      oldest_age_ms: inFlight.length > 0 ? inFlight[0].age_ms : null,
    };
  }
}

const queue = new RequestQueue();

module.exports = { queue, RequestQueue };
