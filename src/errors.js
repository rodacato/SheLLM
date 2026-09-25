function appError(status, code, message, extra) {
  return { status, code, message, ...extra };
}

function invalidRequest(message) {
  return appError(400, 'invalid_request', message);
}

function payloadTooLarge(message) {
  return appError(413, 'invalid_request', message);
}

function authRequired() {
  return appError(401, 'auth_required', 'Missing or invalid Authorization header');
}

function rateLimited(message, retryAfter) {
  return appError(429, 'rate_limited', message, retryAfter ? { retry_after: retryAfter } : undefined);
}

function originNotAllowed(origin) {
  return appError(403, 'origin_not_allowed', `Origin ${origin} is not allowed for this API key`);
}

function notFound(method, routePath) {
  return appError(404, 'not_found', `No route for ${method} ${routePath}`);
}

function modelNotFound(model) {
  return appError(404, 'model_not_found', `The model ${model} does not exist or you do not have access to it`);
}

function contextLengthExceeded(model, detail) {
  return appError(400, 'context_length_exceeded', `${model}: ${detail || 'the prompt is longer than the model can take'}`.slice(0, 500));
}

function cliFailed(provider, stderr) {
  return appError(502, 'cli_failed', `${provider}: ${stderr}`.slice(0, 500));
}

function providerUnavailable(message, extra) {
  return appError(503, 'provider_unavailable', message, extra);
}

function timeout(provider) {
  return appError(504, 'timeout', `${provider}: process killed after timeout`);
}

function isClientError(err) {
  return err.status >= 400 && err.status < 500;
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

// The request log needs the code the caller actually received, and every sender passes here.
function recordErrorCode(res, err) {
  if (res.locals) res.locals.error_code = err.code || 'internal_error';
}

function sendError(res, err, requestId) {
  recordErrorCode(res, err);
  const body = {
    error: err.code || 'internal_error',
    message: err.message || 'Internal server error',
    request_id: requestId || null,
  };
  if (err.retry_after) {
    body.retry_after = err.retry_after;
    res.set('Retry-After', String(err.retry_after));
  }
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// OpenAI-compatible error format for /v1/* endpoints
const CODE_TO_TYPE = {
  invalid_request: 'invalid_request_error',
  auth_required: 'authentication_error',
  rate_limited: 'rate_limit_error',
  origin_not_allowed: 'invalid_request_error',
  model_not_found: 'invalid_request_error',
  context_length_exceeded: 'invalid_request_error',
  not_found: 'invalid_request_error',
};

function sendOpenAIError(res, err) {
  recordErrorCode(res, err);
  const type = CODE_TO_TYPE[err.code] || 'server_error';
  if (err.retry_after) res.set('Retry-After', String(err.retry_after));
  const body = {
    error: { message: err.message || 'Internal server error', type, code: err.code || 'internal_error', param: null },
  };
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// Anthropic-compatible error format for /v1/messages endpoint
const CODE_TO_ANTHROPIC_TYPE = {
  invalid_request: 'invalid_request_error',
  auth_required: 'authentication_error',
  rate_limited: 'rate_limit_error',
  origin_not_allowed: 'permission_error',
  model_not_found: 'not_found_error',
  context_length_exceeded: 'invalid_request_error',
  not_found: 'not_found_error',
};

function sendAnthropicError(res, err) {
  recordErrorCode(res, err);
  const type = CODE_TO_ANTHROPIC_TYPE[err.code] || 'api_error';
  if (err.retry_after) res.set('Retry-After', String(err.retry_after));
  const body = {
    type: 'error',
    error: { type, message: err.message || 'Internal server error' },
  };
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// A /v1 caller parses errors with an OpenAI or Anthropic SDK; anything else gets SheLLM's shape.
function sendApiError(req, res, err, requestId) {
  if (req.path === '/v1/messages') return sendAnthropicError(res, err);
  if (req.path?.startsWith('/v1/')) return sendOpenAIError(res, err);
  return sendError(res, err, requestId);
}

module.exports = {
  invalidRequest,
  payloadTooLarge,
  originNotAllowed,
  authRequired,
  rateLimited,
  modelNotFound,
  contextLengthExceeded,
  notFound,
  cliFailed,
  providerUnavailable,
  timeout,
  fromCatchable,
  isClientError,
  sendError,
  sendApiError,
  sendOpenAIError,
  sendAnthropicError,
};
