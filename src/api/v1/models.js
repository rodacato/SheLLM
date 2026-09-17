const { listProviders, engines } = require('../../routing');

// Any claude-* or gemini-* id also routes; these are the names SheLLM maps to CLI aliases.
function modelsHandler(_req, res) {
  const data = listProviders({ includeDisabled: false })
    .flatMap((provider) => engines[provider.name]?.models || [])
    .map((id) => ({ id, object: 'model', created: 0, owned_by: 'shellm' }));

  res.json({ object: 'list', data });
}

module.exports = { modelsHandler };
