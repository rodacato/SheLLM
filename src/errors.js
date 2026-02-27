function appError(status, code, message, extra) {
  return { status, code, message, ...extra };
}

function invalidRequest(message) {
  return appError(400, 'invalid_request', message);
}

function authRequired() {
  return appError(401, 'auth_required', 'Missing or invalid Authorization header');
}

function rateLimited(message, retryAfter) {
  return appError(429, 'rate_limited', message, retryAfter ? { retry_after: retryAfter } : undefined);
}

function cliFailed(provider, stderr) {
  return appError(502, 'cli_failed', `${provider}: ${stderr}`.slice(0, 500));
}

function providerUnavailable(message) {
  return appError(503, 'provider_unavailable', message);
}

function timeout(provider) {
  return appError(504, 'timeout', `${provider}: process killed after timeout`);
}

// Normalize a caught error (plain object from base.js or structured appError)
function fromCatchable(err, provider) {
  if (err.code && err.status) return err;
  if (err.timeout) return timeout(provider);
  if (err.provider_unavailable) return providerUnavailable(err.message);
  if (err.status === 429) return rateLimited(err.message);
  if (err.status === 400) return invalidRequest(err.message);
  return cliFailed(provider, err.stderr || err.message || 'Unknown error');
}

function sendError(res, err, requestId) {
  const body = {
    error: err.code || 'internal_error',
    message: err.message || 'Internal server error',
    request_id: requestId || null,
  };
  if (err.retry_after) {
    body.retry_after = err.retry_after;
    res.set('Retry-After', String(err.retry_after));
  }
  res.status(err.status || 500).json(body);
}

module.exports = {
  invalidRequest,
  authRequired,
  rateLimited,
  cliFailed,
  providerUnavailable,
  timeout,
  fromCatchable,
  sendError,
};
