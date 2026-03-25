const { listProviders } = require('../routing');

/**
 * GET /v1/models — OpenAI-compatible model list
 */
function modelsHandler(_req, res) {
  const providers = listProviders();
  const seen = new Set();
  const data = [];

  for (const provider of providers) {
    for (const modelId of provider.models) {
      if (!seen.has(modelId)) {
        seen.add(modelId);
        data.push({
          id: modelId,
          object: 'model',
          created: 0,
          owned_by: 'shellm',
        });
      }
    }
  }

  res.json({ object: 'list', data });
}

module.exports = { modelsHandler };
