const { resolveProvider } = require('../router');

function validateCompletionRequest(req, res, next) {
  const { model, prompt } = req.body;

  if (!model) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: model',
    });
  }

  if (!prompt) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: prompt',
    });
  }

  if (typeof prompt !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Field "prompt" must be a string',
    });
  }

  if (!resolveProvider(model)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: `Unknown model: ${model}. Use GET /providers for available models.`,
    });
  }

  next();
}

module.exports = { validateCompletionRequest };
