const { listProviders, getAliases } = require('../router');

/**
 * GET /v1/models — OpenAI-compatible model list
 */
function modelsHandler(_req, res) {
  const providers = listProviders();
  const seen = new Set();
  const data = [];

  // Add all provider models
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

  // Add user-defined aliases
  const aliases = getAliases();
  for (const alias of Object.keys(aliases)) {
    if (!seen.has(alias)) {
      seen.add(alias);
      data.push({
        id: alias,
        object: 'model',
        created: 0,
        owned_by: 'shellm',
      });
    }
  }

  res.json({ object: 'list', data });
}

module.exports = { modelsHandler };
