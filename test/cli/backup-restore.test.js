'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../../src/cli.js');
const SERVER = path.resolve(__dirname, '../../src/server.js');
const DB_MODULE = path.resolve(__dirname, '../../src/db');

// A backup nobody has ever restored is not a backup. This restores one into a location that has
// never run SheLLM, boots the real server against it, and asks it for something only the
// snapshotted database can answer.
describe('a restored snapshot', () => {
  let home;
  let backups;
  let restored;
  let server;
  let port;
  let keyInTheSnapshot;
  let keyMadeAfterwards;

  function run(bin, args, env) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, { env, timeout: 60000 }, (err, stdout, stderr) => (
        err ? reject(new Error(`${err.message}\n${stdout}\n${stderr}`)) : resolve(stdout)));
    });
  }

  function createKey(name) {
    return run(process.execPath, ['-e',
      `const db = require(${JSON.stringify(DB_MODULE)}); db.initDb(); `
      + `process.stdout.write(db.createClient({ name: ${JSON.stringify(name)} }).rawKey);`], { HOME: home });
  }

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-restore-source-'));
    backups = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-restore-backups-'));
    restored = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-restore-target-'));

    fs.mkdirSync(path.join(home, '.config', 'shellm'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'shellm', 'env'),
      'HOST=127.0.0.1\nSHELLM_ADMIN_PASSWORD=a-secret-nobody-else-should-read\n', { mode: 0o600 });
    keyInTheSnapshot = await createKey('before-the-snapshot');

    await run(process.execPath, [CLI, 'backup', '--dir', backups], { HOME: home, PATH: process.env.PATH });
    const snapshot = path.join(backups, fs.readdirSync(backups).find((entry) => !entry.startsWith('.')));

    // Whatever happens to the source afterwards must not show up in the restored copy.
    keyMadeAfterwards = await createKey('after-the-snapshot');

    // The documented restore, done by hand: two files into a state directory and a config
    // directory. Nothing in the snapshot assumes the tool that carried it here.
    fs.mkdirSync(path.join(restored, '.shellm'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(restored, '.config', 'shellm'), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(snapshot, 'shellm.db'), path.join(restored, '.shellm', 'shellm.db'));
    fs.copyFileSync(path.join(snapshot, 'config.env'), path.join(restored, '.config', 'shellm', 'env'));

    server = spawn(process.execPath, [SERVER], {
      env: { HOME: restored, PATH: process.env.PATH, PORT: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server never started:\n${output}`)), 30000);
      server.stdout.on('data', (chunk) => {
        output += chunk;
        for (const line of output.split('\n')) {
          if (!line.startsWith('{')) continue;
          const entry = JSON.parse(line);
          if (entry.event === 'server_start') {
            clearTimeout(timer);
            resolve(entry.port);
          }
        }
      });
      server.stderr.on('data', (chunk) => { output += chunk; });
      server.once('error', reject);
    });
  });

  after(() => {
    if (server) server.kill('SIGKILL');
    for (const dir of [home, backups, restored]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('boots against a restored snapshot', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('restored snapshot still holds the keys that existed when it was taken, and nothing later', async () => {
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: `Bearer ${keyInTheSnapshot}` },
    });
    assert.strictEqual(accepted.status, 200, 'the key that existed at snapshot time did not survive the restore');

    const rejected = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: `Bearer ${keyMadeAfterwards}` },
    });
    assert.strictEqual(rejected.status, 401,
      'the server is answering from the source database, not from the restored snapshot');
  });
});
