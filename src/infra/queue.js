const { rateLimited } = require('../errors');
const logger = require('../lib/logger');

function getMaxConcurrent() {
  try { const { getSetting } = require('../db/settings'); return getSetting('max_concurrent'); }
  catch { return parseInt(process.env.MAX_CONCURRENT || '2', 10); }
}
function getMaxQueueDepth() {
  try { const { getSetting } = require('../db/settings'); return getSetting('max_queue_depth'); }
  catch { return parseInt(process.env.MAX_QUEUE_DEPTH || '10', 10); }
}

class RequestQueue {
  constructor() {
    this.active = 0;
    this.pending = [];
  }

  async enqueue(fn) {
    if (this.pending.length >= getMaxQueueDepth()) {
      logger.warn({ event: 'queue_full', active: this.active, pending: this.pending.length });
      throw rateLimited('Queue is full, try again later');
    }

    if (this.active >= getMaxConcurrent()) {
      await new Promise((resolve) => this.pending.push(resolve));
    }

    this.active++;
    logger.debug({ event: 'queue_dequeue', active: this.active, pending: this.pending.length });
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.pending.length > 0) {
        const next = this.pending.shift();
        next();
      }
    }
  }

  get stats() {
    const { activeStreams, MAX_STREAM_CONCURRENT } = require('./stream-slots');
    return {
      pending: this.pending.length,
      active: this.active,
      max_concurrent: getMaxConcurrent(),
      active_streams: activeStreams(),
      max_stream_concurrent: MAX_STREAM_CONCURRENT,
    };
  }
}

const queue = new RequestQueue();

module.exports = { queue, RequestQueue };
