'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  createClient, listClients, updateClient, deleteClient, rotateClientKey,
  insertAuditLog, getAuditLogs, spentThisMonth,
} = require('../db');
const { nextMonthStartUtc } = require('../lib/time');
const stats = require('../db/stats');
const { isValidOrigin } = require('../middleware/cors');

const router = Router();

// Returns an error to send, or null when the field is acceptable.
function validateOrigins(origins) {
  if (origins === undefined || origins === null) return null;
  if (!Array.isArray(origins)) {
    return invalidRequest('Field "origins" must be an array of origins, or null for no restriction');
  }
  const bad = origins.filter((o) => !isValidOrigin(o));
  if (bad.length > 0) {
    return invalidRequest(`Field "origins" must hold scheme://host[:port] values only, got: ${bad.join(', ')}`);
  }
  return null;
}

function validateSpendLimit(limit) {
  if (limit === undefined || limit === null) return null;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return invalidRequest('Field "spend_limit_usd" must be a positive number of US dollars, or null for no limit');
  }
  return null;
}

function monthSpend(key, now) {
  if (key.spend_limit_usd == null) return null;
  return { spent_usd: spentThisMonth(key.id, now), resets_at: nextMonthStartUtc(now).toISOString() };
}

const USAGE_PERIOD = '7d';
const USAGE_INTERVAL = '-7 days';

// GET /admin/keys
router.get('/keys', (req, res) => {
  const usage = new Map(stats.usageByKey(USAGE_INTERVAL).map(({ id, ...row }) => [id, row]));
  const now = new Date();
  const keys = listClients().map((key) => ({ ...key, usage: usage.get(key.id) || null, month_spend: monthSpend(key, now) }));
  res.json({ keys, usage_period: USAGE_PERIOD });
});

// POST /admin/keys
router.post('/keys', (req, res) => {
  const { name, rpm, models, origins, spend_limit_usd, expires_at, description } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return sendError(res, invalidRequest('Missing required field: name'), req.requestId);
  }

  if (rpm !== undefined && (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm < 1)) {
    return sendError(res, invalidRequest('Field "rpm" must be a positive integer'), req.requestId);
  }

  if (models !== undefined && !Array.isArray(models)) {
    return sendError(res, invalidRequest('Field "models" must be an array of model names'), req.requestId);
  }

  if (expires_at !== undefined && expires_at !== null) {
    if (typeof expires_at !== 'string' || isNaN(Date.parse(expires_at))) {
      return sendError(res, invalidRequest('Field "expires_at" must be an ISO 8601 date string'), req.requestId);
    }
  }

  const fieldError = validateOrigins(origins) || validateSpendLimit(spend_limit_usd);
  if (fieldError) return sendError(res, fieldError, req.requestId);

  try {
    const client = createClient({ name: name.trim(), rpm, models, origins, spend_limit_usd, expires_at, description: description?.trim() || null });
    insertAuditLog({ action: 'created', resource: 'key', resource_id: client.id, details: client.name });
    res.status(201).json({
      key: {
        id: client.id,
        name: client.name,
        raw_key: client.rawKey,
        key_prefix: client.key_prefix,
        key_suffix: client.key_suffix,
        rpm: client.rpm,
        models: client.models,
        origins: client.origins,
        spend_limit_usd: client.spend_limit_usd,
        expires_at: client.expires_at || null,
        description: client.description || null,
        created_at: client.created_at,
      },
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return sendError(res, invalidRequest(`Client name "${name.trim()}" already exists`), req.requestId);
    }
    throw err;
  }
});

// PATCH /admin/keys/:id
router.patch('/keys/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return sendError(res, invalidRequest('Invalid key id'), req.requestId);
  }

  const { name, rpm, models, origins, spend_limit_usd, active, expires_at, description } = req.body || {};

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return sendError(res, invalidRequest('Field "name" must be a non-empty string'), req.requestId);
  }

  if (rpm !== undefined && (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm < 1)) {
    return sendError(res, invalidRequest('Field "rpm" must be a positive integer'), req.requestId);
  }

  if (models !== undefined && models !== null && !Array.isArray(models)) {
    return sendError(res, invalidRequest('Field "models" must be an array or null'), req.requestId);
  }

  if (active !== undefined && active !== 0 && active !== 1) {
    return sendError(res, invalidRequest('Field "active" must be 0 or 1'), req.requestId);
  }

  if (expires_at !== undefined && expires_at !== null) {
    if (typeof expires_at !== 'string' || isNaN(Date.parse(expires_at))) {
      return sendError(res, invalidRequest('Field "expires_at" must be an ISO 8601 date string'), req.requestId);
    }
  }

  const fieldError = validateOrigins(origins) || validateSpendLimit(spend_limit_usd);
  if (fieldError) return sendError(res, fieldError, req.requestId);

  let updated;
  try {
    updated = updateClient(id, {
      name: name?.trim(),
      rpm,
      models,
      origins,
      spend_limit_usd,
      active,
      expires_at,
      description: description !== undefined ? (description?.trim() || null) : undefined,
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return sendError(res, invalidRequest(`Client name "${name.trim()}" already exists`), req.requestId);
    }
    throw err;
  }
  if (!updated) {
    return sendError(res, { status: 404, code: 'not_found', message: `Key id ${id} not found` }, req.requestId);
  }

  insertAuditLog({ action: 'updated', resource: 'key', resource_id: id, details: JSON.stringify(req.body) });
  res.json({ key: updated });
});

// DELETE /admin/keys/:id
router.delete('/keys/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return sendError(res, invalidRequest('Invalid key id'), req.requestId);
  }

  const deleted = deleteClient(id);
  if (!deleted) {
    return sendError(res, { status: 404, code: 'not_found', message: `Key id ${id} not found` }, req.requestId);
  }

  insertAuditLog({ action: 'deleted', resource: 'key', resource_id: id });
  res.json({ deleted: true });
});

// POST /admin/keys/:id/rotate
router.post('/keys/:id/rotate', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return sendError(res, invalidRequest('Invalid key id'), req.requestId);
  }

  const rotated = rotateClientKey(id);
  if (!rotated) {
    return sendError(res, { status: 404, code: 'not_found', message: `Key id ${id} not found` }, req.requestId);
  }

  insertAuditLog({ action: 'rotated', resource: 'key', resource_id: id });
  res.json({
    key: {
      id,
      raw_key: rotated.rawKey,
      key_prefix: rotated.key_prefix,
      key_suffix: rotated.key_suffix,
    },
  });
});

// GET /admin/audit
router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const resource_id = req.query.resource_id ? parseInt(req.query.resource_id, 10) : null;
  const logs = getAuditLogs({ limit, resource_id });
  res.json({ logs });
});

module.exports = router;
