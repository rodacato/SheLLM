'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  getProviderSettings, setProviderEnabled, getProviderLastUsage,
} = require('../db');
const { providers } = require('../router');
const { getHealthStatus } = require('../health');
const logger = require('../lib/logger');

const router = Router();

// GET /admin/providers — enriched provider list with health + last usage
router.get('/providers', async (req, res) => {
  const settings = getProviderSettings();
  const settingsMap = {};
  for (const s of settings) settingsMap[s.name] = s;

  const lastUsageRows = getProviderLastUsage();
  const lastUsageMap = {};
  for (const row of lastUsageRows) lastUsageMap[row.provider] = row;

  let healthData = {};
  try {
    const health = await getHealthStatus();
    healthData = health.providers || {};
  } catch { /* ignore */ }

  const result = Object.keys(providers).map((name) => ({
    name,
    enabled: settingsMap[name] ? !!settingsMap[name].enabled : true,
    installed: healthData[name]?.installed ?? null,
    authenticated: healthData[name]?.authenticated ?? null,
    health_error: healthData[name]?.error || null,
    last_used_at: lastUsageMap[name]?.last_used_at || null,
    last_status: lastUsageMap[name]?.last_status || null,
    models: providers[name].validModels,
  }));

  res.json({ providers: result });
});

// PATCH /admin/providers/:name — toggle enabled/disabled
router.patch('/providers/:name', (req, res) => {
  const { name } = req.params;
  const { enabled } = req.body || {};

  if (!providers[name]) {
    return sendError(res, invalidRequest(`Unknown provider: ${name}`), req.requestId);
  }

  if (enabled === undefined || (enabled !== 0 && enabled !== 1 && enabled !== true && enabled !== false)) {
    return sendError(res, invalidRequest('Field "enabled" must be 0, 1, true, or false'), req.requestId);
  }

  const updated = setProviderEnabled(name, enabled);
  if (!updated) {
    return sendError(res, { status: 404, code: 'not_found', message: `Provider "${name}" not found` }, req.requestId);
  }

  logger.info({ event: 'provider_toggled', provider: name, enabled: !!updated.enabled });
  res.json({ provider: { ...updated, enabled: !!updated.enabled } });
});

module.exports = router;
