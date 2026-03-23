'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  getProviders, getProvider, createProvider, deleteProvider,
  setProviderEnabled, updateProvider,
  getProviderLastUsage, getModelsForProvider, upsertModel, deleteModel,
  insertAuditLog,
} = require('../db');
const { engines, invalidateModelCache } = require('../router');
const { getHealthStatus } = require('../health');
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

  const result = dbProviders.map((p) => ({
    name: p.name,
    type: p.type,
    enabled: !!p.enabled,
    capabilities: p.capabilities,
    priority: p.priority,
    installed: healthData[p.name]?.installed ?? null,
    authenticated: healthData[p.name]?.authenticated ?? null,
    health_error: healthData[p.name]?.error || null,
    last_used_at: lastUsageMap[p.name]?.last_used_at || null,
    last_status: lastUsageMap[p.name]?.last_status || null,
    models: getModelsForProvider(p.name).map((m) => ({
      name: m.name,
      upstream_model: m.upstream_model,
      is_alias: !!m.is_alias,
      alias_for: m.alias_for,
    })),
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
    invalidateModelCache();
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
  invalidateModelCache();
  res.json({ provider: updated });
});

// GET /admin/providers/:name/models — list models for a provider
router.get('/providers/:name/models', (req, res) => {
  const { name } = req.params;
  if (!getProvider(name)) {
    return sendError(res, invalidRequest(`Unknown provider: ${name}`), req.requestId);
  }
  const models = getModelsForProvider(name);
  res.json({ models });
});

// POST /admin/providers/:name/models — add a model
router.post('/providers/:name/models', (req, res) => {
  const { name: providerName } = req.params;
  const { name: modelName, upstream_model, is_alias, alias_for } = req.body || {};

  if (!getProvider(providerName)) {
    return sendError(res, invalidRequest(`Unknown provider: ${providerName}`), req.requestId);
  }
  if (!modelName || typeof modelName !== 'string') {
    return sendError(res, invalidRequest('Field "name" is required'), req.requestId);
  }

  const model = upsertModel({
    name: modelName,
    provider_name: providerName,
    upstream_model: upstream_model || null,
    is_alias: is_alias ? 1 : 0,
    alias_for: alias_for || null,
  });

  insertAuditLog({ action: 'create', resource: 'model', resource_id: modelName, details: JSON.stringify({ provider: providerName }) });
  logger.info({ event: 'model_added', model: modelName, provider: providerName });
  invalidateModelCache();
  res.status(201).json({ model });
});

// DELETE /admin/providers/:name/models/:modelName — remove a model
router.delete('/providers/:name/models/:modelName', (req, res) => {
  const { name: providerName, modelName } = req.params;

  if (!getProvider(providerName)) {
    return sendError(res, invalidRequest(`Unknown provider: ${providerName}`), req.requestId);
  }

  const deleted = deleteModel(modelName);
  if (!deleted) {
    return sendError(res, { status: 404, code: 'not_found', message: `Model "${modelName}" not found` }, req.requestId);
  }

  insertAuditLog({ action: 'delete', resource: 'model', resource_id: modelName, details: JSON.stringify({ provider: providerName }) });
  logger.info({ event: 'model_deleted', model: modelName, provider: providerName });
  invalidateModelCache();
  res.json({ deleted: true });
});

// POST /admin/providers — create a new HTTP provider
router.post('/providers', (req, res) => {
  const { name, chat_url, auth_env, models } = req.body || {};

  if (!name || typeof name !== 'string' || !/^[a-z0-9_-]+$/.test(name)) {
    return sendError(res, invalidRequest('Field "name" is required (lowercase alphanumeric, hyphens, underscores)'), req.requestId);
  }
  if (getProvider(name)) {
    return sendError(res, invalidRequest(`Provider "${name}" already exists`), req.requestId);
  }
  if (!chat_url || typeof chat_url !== 'string') {
    return sendError(res, invalidRequest('Field "chat_url" is required'), req.requestId);
  }

  const healthCheck = {
    url: chat_url.replace(/\/chat\/completions$/, '/models'),
    auth_env: auth_env || null,
    chat_url,
  };

  const provider = createProvider({
    name,
    type: 'http',
    capabilities: { supports_system_prompt: true, supports_json_output: false, supports_max_tokens: true },
    health_check: healthCheck,
  });

  // Seed initial models if provided
  if (Array.isArray(models)) {
    for (const m of models) {
      const modelName = typeof m === 'string' ? m : m.name;
      const upstream = typeof m === 'string' ? null : m.upstream_model || null;
      if (modelName) upsertModel({ name: modelName, provider_name: name, upstream_model: upstream });
    }
  }

  insertAuditLog({ action: 'create', resource: 'provider', resource_id: name, details: JSON.stringify({ type: 'http', chat_url }) });
  logger.info({ event: 'provider_created', provider: name, type: 'http' });
  invalidateModelCache();
  res.status(201).json({ provider });
});

// DELETE /admin/providers/:name — remove an HTTP provider
router.delete('/providers/:name', (req, res) => {
  const { name } = req.params;
  const provider = getProvider(name);
  if (!provider) {
    return sendError(res, invalidRequest(`Unknown provider: ${name}`), req.requestId);
  }
  if (provider.type !== 'http') {
    return sendError(res, invalidRequest(`Cannot delete subprocess provider "${name}" — it requires code changes`), req.requestId);
  }

  deleteProvider(name);
  // Remove from engines if registered
  if (engines[name]) delete engines[name];
  insertAuditLog({ action: 'delete', resource: 'provider', resource_id: name });
  logger.info({ event: 'provider_deleted', provider: name });
  invalidateModelCache();
  res.json({ deleted: true });
});

module.exports = router;
