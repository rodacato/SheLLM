const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../../src/cli.js');

function status(port, home) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, 'status'], { env: { PATH: process.env.PATH, HOME: home, PORT: String(port) }, timeout: 10000 },
      (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr }));
  });
}

describe('shellm status', () => {
  let home;
  let server;

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-home-'));
    require('../../src/db').initDb(':memory:');
    server = require('../../src/server').startServer({ port: 0 });
    await once(server, 'listening');
  });

  after(() => {
    server.close();
    require('../../src/db').closeDb();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reports a running server and exits 0', async () => {
    const result = await status(server.address().port, home);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SheLLM is running on http:\/\/127\.0\.0\.1:\d+/);
  });

  it('exits non-zero when nothing answers on the port', async () => {
    const probe = require('node:net').createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const freePort = probe.address().port;
    probe.close();

    const result = await status(freePort, home);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /not responding/);
  });
});
