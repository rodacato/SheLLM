const { rateLimited } = require('../errors');
const logger = require('../lib/logger');
const config = require('../config');

function getMaxConcurrent() {
  return config.get('MAX_CONCURRENT');
}
function getMaxQueueDepth() {
  return config.get('MAX_QUEUE_DEPTH');
}

// A count says how many are running, never that one has been running nine minutes. These are CLI
// subprocesses measured in seconds, so a wedged one is the failure and the age is the diagnosis.
// Every job carries who asked for it, because a request that runs for minutes writes no log row
// until it finishes and this is the only place it can be seen meanwhile.

// Who a job is for, read off the request that queued it.
function jobFor(req, { stream = false } = {}) {
  return { request_id: req.requestId || null, client: req.clientName || null, path: req.path, stream };
}

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

  // 0 when a slot is free; otherwise where a request arriving now would land in line. Read it
  // immediately before enqueue: nothing else runs in between, so the two agree.
  get nextPosition() {
    return this.active >= getMaxConcurrent() ? this.pending.length + 1 : 0;
  }

  async enqueue(fn, job = {}, { onQueued } = {}) {
    if (this.pending.length >= getMaxQueueDepth()) {
      logger.warn({ event: 'queue_full', active: this.active, pending: this.pending.length });
      throw rateLimited('Queue is full, try again later');
    }

    const arrivedAt = this.now();
    const position = this.nextPosition;
    if (position > 0) {
      if (onQueued) onQueued(position);
      await new Promise((resolve) => this.pending.push({ resolve, job, arrivedAt }));
    }
    const queued_ms = this.now() - arrivedAt;

    const id = this.nextId++;
    this.running.set(id, { startedAt: this.now(), job });
    logger.debug({ event: 'queue_dequeue', active: this.active, pending: this.pending.length });
    try {
      return await fn({ queued_ms, position });
    } finally {
      this.running.delete(id);
      if (this.pending.length > 0) {
        const next = this.pending.shift();
        next.resolve();
      }
    }
  }

  // Running first, oldest first: the one worth looking at is the one that has been running
  // longest. Then the line, in the order it will run. Bounded by MAX_CONCURRENT + MAX_QUEUE_DEPTH.
  get inFlight() {
    const at = this.now();
    const running = [...this.running.values()]
      .map(({ startedAt, job }) => ({ ...job, state: 'running', age_ms: at - startedAt }))
      .sort((a, b) => b.age_ms - a.age_ms);
    const queued = this.pending.map(({ job, arrivedAt }, i) => (
      { ...job, state: 'queued', age_ms: at - arrivedAt, position: i + 1 }
    ));
    return [...running, ...queued];
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
      timeout_ms: config.get('TIMEOUT_MS'),
      in_flight: inFlight,
      oldest_age_ms: inFlight[0]?.state === 'running' ? inFlight[0].age_ms : null,
    };
  }
}

const queue = new RequestQueue();

module.exports = { queue, RequestQueue, jobFor };
