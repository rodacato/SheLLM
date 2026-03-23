'use strict';

const { Router } = require('express');
const { sendError, invalidRequest } = require('../errors');
const { getSetting, setSetting, deleteSetting, listSettings, REGISTRY } = require('../db/settings');
const { insertAuditLog } = require('../db');
const logger = require('../lib/logger');

const router = Router();

// GET /admin/settings — list all settings with effective values
router.get('/settings', (_req, res) => {
  res.json({ settings: listSettings() });
});

// PATCH /admin/settings/:key — update a setting
router.patch('/settings/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};

  if (!REGISTRY[key]) {
    return sendError(res, invalidRequest(`Unknown setting: ${key}`), req.requestId);
  }

  if (value === undefined) {
    return sendError(res, invalidRequest('Field "value" is required'), req.requestId);
  }

  try {
    const oldValue = getSetting(key);
    const result = setSetting(key, value);
    insertAuditLog({
      action: 'update',
      resource: 'setting',
      resource_id: key,
      details: JSON.stringify({ old: oldValue, new: result.value }),
    });
    logger.info({ event: 'setting_updated', key, old: oldValue, new: result.value });
    res.json({ setting: { ...result, type: REGISTRY[key].type, description: REGISTRY[key].description } });
  } catch (err) {
    return sendError(res, invalidRequest(err.message), req.requestId);
  }
});

// DELETE /admin/settings/:key — reset to default (remove DB override)
router.delete('/settings/:key', (req, res) => {
  const { key } = req.params;

  if (!REGISTRY[key]) {
    return sendError(res, invalidRequest(`Unknown setting: ${key}`), req.requestId);
  }

  const deleted = deleteSetting(key);
  if (deleted) {
    insertAuditLog({ action: 'delete', resource: 'setting', resource_id: key });
    logger.info({ event: 'setting_reset', key });
  }

  res.json({ reset: true, value: getSetting(key), source: 'default' });
});

module.exports = router;
