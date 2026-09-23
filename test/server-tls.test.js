'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

// A real certificate against a real TLS handshake: the point of the setting is that a browser can
// complete one, which no mocked socket can show.
function selfSignedPair() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  return { dir, key, cert };
}

function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port, path: requestPath, rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

describe('serving over TLS', () => {
  let startServer;
  let pair;

  before(() => {
    pair = selfSignedPair();
    require('../src/db').initDb(':memory:');
    ({ startServer } = require('../src/server'));
  });

  after(() => {
    delete process.env.SHELLM_TLS_CERT;
    delete process.env.SHELLM_TLS_KEY;
    fs.rmSync(pair.dir, { recursive: true, force: true });
    require('../src/db').closeDb();
  });

  it('stays plain HTTP when only one half of the pair is set', async () => {
    process.env.SHELLM_TLS_CERT = pair.cert;
    delete process.env.SHELLM_TLS_KEY;

    const server = startServer({ port: 0 });
    await once(server, 'listening');
    try {
      await assert.rejects(get(server.address().port, '/health'), /wrong version number|EPROTO|socket hang up/);
    } finally {
      server.close();
      delete process.env.SHELLM_TLS_CERT;
    }
  });

  it('answers over HTTPS when both are set', async () => {
    process.env.SHELLM_TLS_CERT = pair.cert;
    process.env.SHELLM_TLS_KEY = pair.key;

    const server = startServer({ port: 0 });
    await once(server, 'listening');
    try {
      const res = await get(server.address().port, '/health');
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
    } finally {
      server.close();
    }
  });
});
