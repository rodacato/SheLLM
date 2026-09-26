'use strict';

// The Anthropic API's own switch for the 1M context window: the same model id plus this beta,
// with a date that Anthropic versions (ADR-0009).
function wantsLongContext(req) {
  return String(req.headers['anthropic-beta'] || '').split(',').some((beta) => beta.trim().startsWith('context-1m-'));
}

module.exports = { wantsLongContext };
