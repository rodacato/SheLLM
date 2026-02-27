const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  initDb, getDb, closeDb,
  createClient, listClients, updateClient, deleteClient,
  rotateClientKey, findClientByKey,
  insertRequestLog, pruneOldLogs,
  hashKey, generateKey,
} = require('../../src/db');

describe('db layer', () => {
  before(() => {
    initDb(':memory:');
  });

  after(() => {
    closeDb();
  });

  it('initDb creates tables', () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t) => t.name);
    assert.ok(names.includes('clients'));
    assert.ok(names.includes('request_logs'));
  });

  it('getDb returns the cached connection', () => {
    assert.ok(getDb() !== null);
  });

  describe('generateKey', () => {
    it('returns shellm- prefix + 32 hex chars', () => {
      const key = generateKey();
      assert.ok(key.startsWith('shellm-'));
      assert.strictEqual(key.length, 7 + 32); // "shellm-" + 32 hex
      assert.match(key.slice(7), /^[0-9a-f]{32}$/);
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 20 }, () => generateKey()));
      assert.strictEqual(keys.size, 20);
    });
  });

  describe('hashKey', () => {
    it('returns 64 char hex SHA-256', () => {
      const hash = hashKey('shellm-abc123');
      assert.match(hash, /^[0-9a-f]{64}$/);
    });

    it('same input produces same hash', () => {
      assert.strictEqual(hashKey('test-key'), hashKey('test-key'));
    });

    it('different inputs produce different hashes', () => {
      assert.notStrictEqual(hashKey('key-a'), hashKey('key-b'));
    });
  });

  describe('createClient', () => {
    it('creates a client and returns rawKey', () => {
      const client = createClient({ name: 'test-app' });
      assert.strictEqual(client.name, 'test-app');
      assert.ok(client.rawKey.startsWith('shellm-'));
      assert.strictEqual(client.key_prefix, client.rawKey.slice(0, 8));
      assert.strictEqual(client.rpm, 10);
      assert.strictEqual(client.models, null);
      assert.strictEqual(client.active, 1);
      assert.ok(client.created_at);
      assert.ok(client.id);
    });

    it('creates a client with custom rpm and models', () => {
      const client = createClient({ name: 'custom-app', rpm: 20, models: ['claude', 'gemini'] });
      assert.strictEqual(client.rpm, 20);
      assert.deepStrictEqual(client.models, ['claude', 'gemini']);
    });

    it('rejects duplicate name', () => {
      assert.throws(() => createClient({ name: 'test-app' }), /UNIQUE/);
    });
  });

  describe('listClients', () => {
    it('returns all clients without key_hash', () => {
      const clients = listClients();
      assert.ok(clients.length >= 2);
      for (const c of clients) {
        assert.ok('id' in c);
        assert.ok('name' in c);
        assert.ok('key_prefix' in c);
        assert.ok(!('key_hash' in c));
        assert.ok(!('rawKey' in c));
      }
    });
  });

  describe('findClientByKey', () => {
    it('finds client by raw key', () => {
      const created = createClient({ name: 'find-me' });
      const found = findClientByKey(created.rawKey);
      assert.ok(found);
      assert.strictEqual(found.name, 'find-me');
      assert.strictEqual(found.id, created.id);
    });

    it('returns null for unknown key', () => {
      assert.strictEqual(findClientByKey('shellm-nonexistent'), null);
    });
  });

  describe('updateClient', () => {
    it('updates rpm', () => {
      const client = createClient({ name: 'update-rpm' });
      const updated = updateClient(client.id, { rpm: 50 });
      assert.strictEqual(updated.rpm, 50);
      assert.strictEqual(updated.name, 'update-rpm');
    });

    it('updates active status', () => {
      const client = createClient({ name: 'update-active' });
      const updated = updateClient(client.id, { active: 0 });
      assert.strictEqual(updated.active, 0);
    });

    it('updates models', () => {
      const client = createClient({ name: 'update-models' });
      const updated = updateClient(client.id, { models: ['claude'] });
      assert.deepStrictEqual(updated.models, ['claude']);
    });

    it('returns null for no fields', () => {
      const client = createClient({ name: 'update-none' });
      assert.strictEqual(updateClient(client.id, {}), null);
    });

    it('returns null for non-existent id', () => {
      assert.strictEqual(updateClient(99999, { rpm: 5 }), null);
    });
  });

  describe('deleteClient', () => {
    it('deletes existing client', () => {
      const client = createClient({ name: 'delete-me' });
      assert.strictEqual(deleteClient(client.id), true);
      assert.strictEqual(findClientByKey(client.rawKey), null);
    });

    it('returns false for non-existent id', () => {
      assert.strictEqual(deleteClient(99999), false);
    });
  });

  describe('rotateClientKey', () => {
    it('rotates key and returns new rawKey', () => {
      const client = createClient({ name: 'rotate-me' });
      const oldKey = client.rawKey;
      const rotated = rotateClientKey(client.id);

      assert.ok(rotated.rawKey.startsWith('shellm-'));
      assert.notStrictEqual(rotated.rawKey, oldKey);
      assert.strictEqual(rotated.key_prefix, rotated.rawKey.slice(0, 8));

      // Old key no longer works
      assert.strictEqual(findClientByKey(oldKey), null);
      // New key works
      assert.ok(findClientByKey(rotated.rawKey));
    });

    it('returns null for non-existent id', () => {
      assert.strictEqual(rotateClientKey(99999), null);
    });
  });

  describe('request logs', () => {
    it('insertRequestLog inserts a log entry', () => {
      insertRequestLog({
        request_id: 'req-1',
        client_name: 'test-app',
        provider: 'claude',
        model: 'claude',
        status: 200,
        duration_ms: 1500,
        queued_ms: 100,
        tokens: 500,
        cost_usd: 0.005,
      });

      const row = getDb().prepare('SELECT * FROM request_logs WHERE request_id = ?').get('req-1');
      assert.ok(row);
      assert.strictEqual(row.client_name, 'test-app');
      assert.strictEqual(row.provider, 'claude');
      assert.strictEqual(row.status, 200);
      assert.strictEqual(row.duration_ms, 1500);
      assert.strictEqual(row.tokens, 500);
    });

    it('insertRequestLog handles null fields', () => {
      insertRequestLog({
        request_id: 'req-2',
        client_name: null,
        provider: null,
        model: 'gemini',
        status: 400,
        duration_ms: 5,
        queued_ms: null,
        tokens: null,
        cost_usd: null,
      });

      const row = getDb().prepare('SELECT * FROM request_logs WHERE request_id = ?').get('req-2');
      assert.ok(row);
      assert.strictEqual(row.client_name, null);
      assert.strictEqual(row.tokens, null);
    });

    it('pruneOldLogs removes entries older than N days', () => {
      // Insert an old log manually
      getDb().prepare(`
        INSERT INTO request_logs (request_id, status, created_at)
        VALUES ('old-req', 200, datetime('now', '-60 days'))
      `).run();

      const before = getDb().prepare("SELECT COUNT(*) as count FROM request_logs WHERE request_id = 'old-req'").get();
      assert.strictEqual(before.count, 1);

      pruneOldLogs(30);

      const after = getDb().prepare("SELECT COUNT(*) as count FROM request_logs WHERE request_id = 'old-req'").get();
      assert.strictEqual(after.count, 0);
    });
  });
});
