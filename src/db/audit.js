'use strict';

function insertAuditLog({ action, resource, resource_id = null, details = null }) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return;
  db.prepare('INSERT INTO admin_audit_logs (action, resource, resource_id, details) VALUES (?, ?, ?, ?)')
    .run(action, resource, resource_id, details);
}

function getAuditLogs({ limit = 100, resource_id = null } = {}) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  if (resource_id) {
    return db.prepare('SELECT * FROM admin_audit_logs WHERE resource_id = ? ORDER BY id DESC LIMIT ?').all(resource_id, limit);
  }
  return db.prepare('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { insertAuditLog, getAuditLogs };
