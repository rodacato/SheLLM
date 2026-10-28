function appError(status, code, message, extra) {
  return { status, code, message, ...extra };
}

function invalidRequest(message) {
  return appError(400, 'invalid_request', message);
}

// OpenAI's own code for a parameter the model cannot honour; param names it, as OpenAI does.
function unsupportedParameter(param, message) {
  return appError(400, 'unsupported_parameter', message, { param });
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

// should_retry: false because waiting seconds cannot help, and both SDKs honour x-should-retry.
function spendLimitReached(clientName, limit, retryAfter, resetsAt) {
  const message = `Monthly spend limit of $${limit.toFixed(2)} (API-equivalent cost) reached for client: ${clientName}. It resets at ${resetsAt}`;
  return appError(429, 'spend_limit_exceeded', message, { retry_after: retryAfter, should_retry: false });
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

// The request log credits a failure to the provider that produced it. A gateway refusal (full
// queue) is never blamed on one: the usage-limit banner reads a provider 429 as the CLI's own.
function blame(err, provider, cliMs) {
  if (err && typeof err === 'object') Object.assign(err, { provider, cli_ms: cliMs });
  return err;
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

// A stream already answered 200, so a provider's 429 is kept where the usage-limit banner reads
// it. cliStart is null when the refusal was the gateway's (a full queue): that is not a usage limit.
function keepProviderLimit(res, failure, cliStart) {
  if (failure.status !== 429 || cliStart == null || !res.locals) return;
  res.locals.metrics = { ...res.locals.metrics, api_error_status: 429 };
}

// The request log needs the code the caller actually received, and the status the provider's API
// answered when the CLI reported one. Every sender passes here.
function recordErrorCode(res, err) {
  if (!res.locals) return;
  res.locals.error_code = err.code || 'internal_error';
  if (err.api_error_status) res.locals.metrics = { ...res.locals.metrics, api_error_status: err.api_error_status };
}

function setRetryHeaders(res, err) {
  if (err.retry_after) res.set('Retry-After', String(err.retry_after));
  if (err.should_retry === false) res.set('x-should-retry', 'false');
}

function sendError(res, err, requestId) {
  recordErrorCode(res, err);
  setRetryHeaders(res, err);
  const body = {
    error: err.code || 'internal_error',
    message: err.message || 'Internal server error',
    request_id: requestId || null,
  };
  if (err.retry_after) body.retry_after = err.retry_after;
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// OpenAI-compatible error format for /v1/* endpoints
const CODE_TO_TYPE = {
  invalid_request: 'invalid_request_error',
  unsupported_parameter: 'invalid_request_error',
  auth_required: 'authentication_error',
  rate_limited: 'rate_limit_error',
  spend_limit_exceeded: 'insufficient_quota',
  origin_not_allowed: 'invalid_request_error',
  model_not_found: 'invalid_request_error',
  context_length_exceeded: 'invalid_request_error',
  not_found: 'invalid_request_error',
};

function openAIErrorType(err) {
  return CODE_TO_TYPE[err.code] || 'server_error';
}

function sendOpenAIError(res, err) {
  recordErrorCode(res, err);
  const type = openAIErrorType(err);
  setRetryHeaders(res, err);
  const body = {
    error: { message: err.message || 'Internal server error', type, code: err.code || 'internal_error', param: err.param ?? null },
  };
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// Anthropic-compatible error format for /v1/messages endpoint
const CODE_TO_ANTHROPIC_TYPE = {
  invalid_request: 'invalid_request_error',
  unsupported_parameter: 'invalid_request_error',
  auth_required: 'authentication_error',
  rate_limited: 'rate_limit_error',
  spend_limit_exceeded: 'rate_limit_error',
  origin_not_allowed: 'permission_error',
  model_not_found: 'not_found_error',
  context_length_exceeded: 'invalid_request_error',
  not_found: 'not_found_error',
};

function anthropicErrorType(err) {
  return CODE_TO_ANTHROPIC_TYPE[err.code] || 'api_error';
}

function sendAnthropicError(res, err) {
  recordErrorCode(res, err);
  const type = anthropicErrorType(err);
  setRetryHeaders(res, err);
  const body = {
    type: 'error',
    error: { type, message: err.message || 'Internal server error' },
    request_id: res.get('request-id') ?? null,
  };
  if (err.available_providers) body.available_providers = err.available_providers;
  res.status(err.status || 500).json(body);
}

// A /v1 caller parses errors with an OpenAI or Anthropic SDK; anything else gets SheLLM's shape.
// Off /v1/messages only the anthropic-version header, which the Anthropic SDK always sends, tells
// the two apart.
function sendApiError(req, res, err, requestId) {
  if (req.path === '/v1/messages' || (req.path?.startsWith('/v1/') && req.headers['anthropic-version'])) return sendAnthropicError(res, err);
  if (req.path?.startsWith('/v1/')) return sendOpenAIError(res, err);
  return sendError(res, err, requestId);
}

module.exports = {
  invalidRequest,
  unsupportedParameter,
  payloadTooLarge,
  originNotAllowed,
  authRequired,
  rateLimited,
  spendLimitReached,
  modelNotFound,
  contextLengthExceeded,
  notFound,
  cliFailed,
  providerUnavailable,
  timeout,
  fromCatchable,
  recordErrorCode,
  isClientError,
  blame,
  keepProviderLimit,
  sendError,
  sendApiError,
  sendOpenAIError,
  sendAnthropicError,
  openAIErrorType,
  anthropicErrorType,
};
