const { listProviders, engines } = require('../../routing');
const { peekCatalog } = require('../../infra/model-catalog');
const { limitsFor } = require('../../infra/model-limits');

// Every name that routes (the declared aliases) plus every model the catalog knows, once each,
// with the limits ADR-0009 describes and where each came from.
function modelsHandler(_req, res) {
  const data = [];
  const seen = new Set();
  for (const provider of listProviders({ includeDisabled: false })) {
    const entries = new Map(peekCatalog(provider.name).models.map((m) => [m.id, m]));
    for (const id of [...(engines[provider.name]?.models || []), ...entries.keys()]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const { limits, sources } = limitsFor(id, entries.get(id));
      data.push({ id, object: 'model', created: 0, owned_by: 'shellm', ...limits, x_shellm: { sources } });
    }
  }

  res.json({ object: 'list', data });
}

module.exports = { modelsHandler };
