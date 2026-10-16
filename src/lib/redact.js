'use strict';

// Anything that looks like a credential, for text a CLI wrote and an operator will read.
function redactTokens(text) {
  return (text || '')
    .replace(/(sk-|csk-|key-|shellm-)[A-Za-z0-9_-]{10,}/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]');
}

module.exports = { redactTokens };
