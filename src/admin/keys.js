'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  createClient, listClients, updateClient, deleteClient, rotateClientKey,
  insertAuditLog, getAuditLogs,
} = require('../db');
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

const USAGE_PERIOD = '7d';
const USAGE_INTERVAL = '-7 days';

// GET /admin/keys
router.get('/keys', (req, res) => {
  const usage = new Map(stats.usageByKey(USAGE_INTERVAL).map(({ id, ...row }) => [id, row]));
  const keys = listClients().map((key) => ({ ...key, usage: usage.get(key.id) || null }));
  res.json({ keys, usage_period: USAGE_PERIOD });
});

// POST /admin/keys
router.post('/keys', (req, res) => {
  const { name, rpm, models, origins, expires_at, description } = req.body || {};

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

  const originsError = validateOrigins(origins);
  if (originsError) return sendError(res, originsError, req.requestId);

  try {
    const client = createClient({ name: name.trim(), rpm, models, origins, expires_at, description: description?.trim() || null });
    insertAuditLog({ action: 'created', resource: 'key', resource_id: client.id, details: client.name });
    res.status(201).json({
      key: {
        id: client.id,
        name: client.name,
        raw_key: client.rawKey,
        key_prefix: client.key_prefix,
        rpm: client.rpm,
        models: client.models,
        origins: client.origins,
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

  const { rpm, models, origins, active, expires_at, description } = req.body || {};

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

  const originsError = validateOrigins(origins);
  if (originsError) return sendError(res, originsError, req.requestId);

  const updated = updateClient(id, { rpm, models, origins, active, expires_at, description: description !== undefined ? (description?.trim() || null) : undefined });
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
