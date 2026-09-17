const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

describe('startServer', () => {
  let startServer;
  let originalHost;

  before(() => {
    originalHost = process.env.HOST;
    delete process.env.HOST;
    require('../src/db').initDb(':memory:');
    ({ startServer } = require('../src/server'));
  });

  after(() => {
    if (originalHost !== undefined) process.env.HOST = originalHost;
    require('../src/db').closeDb();
  });

  it('listens on 127.0.0.1 by default', async () => {
    const server = startServer({ port: 0 });
    await once(server, 'listening');
    try {
      assert.strictEqual(server.address().address, '127.0.0.1');
    } finally {
      server.close();
    }
  });

  it('binds the interface named in HOST', async () => {
    process.env.HOST = '0.0.0.0';
    const server = startServer({ port: 0 });
    await once(server, 'listening');
    try {
      assert.strictEqual(server.address().address, '0.0.0.0');
    } finally {
      server.close();
      delete process.env.HOST;
    }
  });
});
