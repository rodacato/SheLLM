'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, '../fixtures/claude/2.1.273');

const FAIL = 'FAIL_THIS_RUN';

// The real transcripts of claude 2.1.273: stream-json when asked to stream, one result object
// otherwise. A prompt carrying FAIL makes it exit 1 the way a crashed CLI does.
function fakeClaude() {
  return `#!${process.execPath}
const fs = require('fs');
const streaming = process.argv.includes('stream-json');
const file = streaming ? 'stream-json.jsonl' : 'result-haiku.json';
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (input.includes(${JSON.stringify(FAIL)})) {
    process.stderr.write('simulated CLI crash');
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(${JSON.stringify(FIXTURES)} + '/' + file, 'utf8'));
});
`;
}

// A SheLLM on a real port with the fake claude first on PATH. base.js captures PATH when it
// loads, so this has to run before anything under src/ is required.
async function startShellm() {
  assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
  const originalPath = process.env.PATH;
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-sdk-'));
  fs.writeFileSync(path.join(fakeBin, 'claude'), fakeClaude(), { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  process.env.SHELLM_GLOBAL_RPM = '200';
  process.env.LOG_LEVEL = 'error';

  const db = require('../../src/db');
  try { db.closeDb(); } catch { /* not open */ }
  db.initDb(':memory:');
  const apiKey = db.createClient({ name: 'sdk-client', rpm: 100 }).rawKey;

  const app = require('../../src/app');
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.closeDb();
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }

  return { origin, apiKey, stop };
}

const STREAM_TEXT = '1\n2\n3\n4\n5';
const RESULT_TEXT = 'OK';

// What the fixtures' result events report.
const RESULT_USAGE = { input_tokens: 10, cache_creation_input_tokens: 8190, cache_read_input_tokens: 20828, output_tokens: 61 };
const STREAM_USAGE = { input_tokens: 2, cache_creation_input_tokens: 43249, cache_read_input_tokens: 19670, output_tokens: 11 };

module.exports = { startShellm, FAIL, STREAM_TEXT, RESULT_TEXT, RESULT_USAGE, STREAM_USAGE };
