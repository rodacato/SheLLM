const config = require('../config');

const MAX_STREAM_CONCURRENT = config.get('MAX_STREAM_CONCURRENT');

let _activeStreams = 0;

function acquireStreamSlot() {
  if (_activeStreams >= MAX_STREAM_CONCURRENT) return false;
  _activeStreams++;
  return true;
}

function releaseStreamSlot() {
  if (_activeStreams > 0) _activeStreams--;
}

function activeStreams() {
  return _activeStreams;
}

module.exports = { acquireStreamSlot, releaseStreamSlot, activeStreams, MAX_STREAM_CONCURRENT };
