'use strict';

// One namespaced block, the same shape in both wire formats, so a benchmark reads the same four
// numbers whichever API it speaks. Unknown values stay null rather than disappearing: a missing
// key and a value of zero are different answers, and a column that vanishes is worse than one
// that says it does not know.
function shellmMeta({ cost_usd = null, queue_ms = null, cli_ms = null, ttft_ms = null } = {}) {
  return { cost_usd, queue_ms, cli_ms, ttft_ms };
}

module.exports = { shellmMeta };
