const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { setImmediate: nextTurn } = require('node:timers/promises');

const status = (host, port) => new Promise((resolve, reject) => {
  http.get({ host, port, path: '/health', agent: false }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

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

  it('binds every address in HOST on one port, and closing the server closes them all', async () => {
    process.env.HOST = '127.0.0.1,127.0.0.2';
    const server = startServer({ port: 0 });
    await once(server, 'listening');
    const { port } = server.address();
    try {
      await nextTurn();
      assert.strictEqual(await status('127.0.0.1', port), 200);
      assert.strictEqual(await status('127.0.0.2', port), 200);
    } finally {
      server.close();
      delete process.env.HOST;
    }
    await once(server, 'close');
    await assert.rejects(status('127.0.0.2', port), { code: 'ECONNREFUSED' });
  });
});
