const { resolveProvider } = require('../router');
const { sendError, invalidRequest } = require('../errors');

const MAX_PROMPT_LENGTH = 50000;

function validateCompletionRequest(req, res, next) {
  const { model, prompt, system, max_tokens } = req.body;

  if (!model) {
    return sendError(res, invalidRequest('Missing required field: model'), req.requestId);
  }

  if (!prompt) {
    return sendError(res, invalidRequest('Missing required field: prompt'), req.requestId);
  }

  if (typeof prompt !== 'string') {
    return sendError(res, invalidRequest('Field "prompt" must be a string'), req.requestId);
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sendError(res, invalidRequest(
      `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${prompt.length})`
    ), req.requestId);
  }

  if (system !== undefined && typeof system !== 'string') {
    return sendError(res, invalidRequest('Field "system" must be a string'), req.requestId);
  }

  if (max_tokens !== undefined) {
    if (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > 128000) {
      return sendError(res, invalidRequest('Field "max_tokens" must be an integer between 1 and 128000'), req.requestId);
    }
  }

  if (!resolveProvider(model)) {
    return sendError(res, invalidRequest(`Unknown model: ${model}. Use GET /providers for available models.`), req.requestId);
  }

  next();
}

module.exports = { validateCompletionRequest };
