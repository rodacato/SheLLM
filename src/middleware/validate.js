const { resolveProvider } = require('../router');
const { sendError, invalidRequest } = require('../errors');

function validateCompletionRequest(req, res, next) {
  const { model, prompt } = req.body;

  if (!model) {
    return sendError(res, invalidRequest('Missing required field: model'), req.requestId);
  }

  if (!prompt) {
    return sendError(res, invalidRequest('Missing required field: prompt'), req.requestId);
  }

  if (typeof prompt !== 'string') {
    return sendError(res, invalidRequest('Field "prompt" must be a string'), req.requestId);
  }

  if (!resolveProvider(model)) {
    return sendError(res, invalidRequest(`Unknown model: ${model}. Use GET /providers for available models.`), req.requestId);
  }

  next();
}

module.exports = { validateCompletionRequest };
