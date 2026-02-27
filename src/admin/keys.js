'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const {
  createClient, listClients, updateClient, deleteClient, rotateClientKey,
} = require('../db');

const router = Router();

// GET /admin/keys
router.get('/keys', (req, res) => {
  const keys = listClients();
  res.json({ keys });
});

// POST /admin/keys
router.post('/keys', (req, res) => {
  const { name, rpm, models } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return sendError(res, invalidRequest('Missing required field: name'), req.requestId);
  }

  if (rpm !== undefined && (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm < 1)) {
    return sendError(res, invalidRequest('Field "rpm" must be a positive integer'), req.requestId);
  }

  if (models !== undefined && !Array.isArray(models)) {
    return sendError(res, invalidRequest('Field "models" must be an array of model names'), req.requestId);
  }

  try {
    const client = createClient({ name: name.trim(), rpm, models });
    res.status(201).json({
      key: {
        id: client.id,
        name: client.name,
        raw_key: client.rawKey,
        key_prefix: client.key_prefix,
        rpm: client.rpm,
        models: client.models,
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

  const { rpm, models, active } = req.body || {};

  if (rpm !== undefined && (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm < 1)) {
    return sendError(res, invalidRequest('Field "rpm" must be a positive integer'), req.requestId);
  }

  if (models !== undefined && models !== null && !Array.isArray(models)) {
    return sendError(res, invalidRequest('Field "models" must be an array or null'), req.requestId);
  }

  if (active !== undefined && active !== 0 && active !== 1) {
    return sendError(res, invalidRequest('Field "active" must be 0 or 1'), req.requestId);
  }

  const updated = updateClient(id, { rpm, models, active });
  if (!updated) {
    return sendError(res, { status: 404, code: 'not_found', message: `Key id ${id} not found` }, req.requestId);
  }

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

  res.json({
    key: {
      id,
      raw_key: rotated.rawKey,
      key_prefix: rotated.key_prefix,
    },
  });
});

module.exports = router;
