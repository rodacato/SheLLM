'use strict';

const { EventEmitter } = require('node:events');

const emitter = new EventEmitter();
emitter.setMaxListeners(20);

let batch = [];
let batchTimer = null;

/**
 * Emit a log entry to all stream subscribers.
 * Batches entries over 1s to avoid flooding clients.
 */
function emitLog(entry) {
  batch.push(entry);
  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      const entries = batch;
      batch = [];
      batchTimer = null;
      emitter.emit('logs', entries);
    }, 1000);
  }
}

module.exports = { emitter, emitLog };
