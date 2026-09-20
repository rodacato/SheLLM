'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  getProviders, getProvider,
  setProviderEnabled, updateProvider,
  getProviderLastUsage,
  insertAuditLog,
} = require('../db');
const { engines } = require('../routing');
const { getHealthStatus } = require('../infra/health');
const { readCatalog } = require('../infra/model-catalog');
const { getCircuitState } = require('../infra/circuit-breaker');
const logger = require('../lib/logger');

const router = Router();

// GET /admin/providers — enriched provider list with health + last usage + models
router.get('/providers', async (req, res) => {
  const dbProviders = getProviders();

  const lastUsageRows = getProviderLastUsage();
  const lastUsageMap = {};
  for (const row of lastUsageRows) lastUsageMap[row.provider] = row;

  let healthData = {};
  try {
    const health = await getHealthStatus();
    healthData = health.providers || {};
  } catch { /* ignore */ }

  const catalogs = Object.fromEntries(await Promise.all(
    dbProviders.map(async (p) => [p.name, await readCatalog(p.name)]),
  ));

  const result = dbProviders.map((p) => ({
    name: p.name,
    type: p.type,
    enabled: !!p.enabled,
    capabilities: p.capabilities,
    priority: p.priority,
    installed: healthData[p.name]?.installed ?? null,
    authenticated: healthData[p.name]?.authenticated ?? null,
    health_error: healthData[p.name]?.error || null,
    version: healthData[p.name]?.version || null,
    last_used_at: lastUsageMap[p.name]?.last_used_at || null,
    last_status: lastUsageMap[p.name]?.last_status || null,
    circuit: getCircuitState(p.name),
    models: engines[p.name]?.models || [],
    catalog: catalogs[p.name],
  }));

  res.json({ providers: result });
});

// PATCH /admin/providers/:name — update provider (enabled, capabilities, priority)
router.patch('/providers/:name', (req, res) => {
  const { name } = req.params;
  const body = req.body || {};

  const provider = getProvider(name);
  if (!provider) {
    return sendError(res, invalidRequest(`Unknown provider: ${name}`), req.requestId);
  }

  // Handle simple enabled toggle (backwards compatible)
  if (body.enabled !== undefined && Object.keys(body).length === 1) {
    const { enabled } = body;
    if (enabled !== 0 && enabled !== 1 && enabled !== true && enabled !== false) {
      return sendError(res, invalidRequest('Field "enabled" must be 0, 1, true, or false'), req.requestId);
    }
    const updated = setProviderEnabled(name, enabled);
    if (!updated) {
      return sendError(res, { status: 404, code: 'not_found', message: `Provider "${name}" not found` }, req.requestId);
    }
    logger.info({ event: 'provider_toggled', provider: name, enabled: !!updated.enabled });
    return res.json({ provider: { ...updated, enabled: !!updated.enabled } });
  }

  // General update (capabilities, priority, enabled)
  const fields = {};
  if (body.enabled !== undefined) fields.enabled = body.enabled ? 1 : 0;
  if (body.capabilities !== undefined) fields.capabilities = body.capabilities;
  if (body.priority !== undefined) fields.priority = body.priority;

  if (Object.keys(fields).length === 0) {
    return sendError(res, invalidRequest('No valid fields to update'), req.requestId);
  }

  const updated = updateProvider(name, fields);
  insertAuditLog({ action: 'update', resource: 'provider', resource_id: name, details: JSON.stringify(fields) });
  logger.info({ event: 'provider_updated', provider: name, fields: Object.keys(fields) });
  res.json({ provider: updated });
});

module.exports = router;
