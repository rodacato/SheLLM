const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A real API failure, recorded from the CLI; the other statuses reuse its shape.
const FIXTURE = path.resolve(__dirname, '../fixtures/claude/2.1.273/result-unknown-model.json');

const OVERLOADED = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
const LIMITED = 'API Error: 429 rate limit exceeded';
// The two labels the CLI's limit template has carried: 2.1.302 and earlier, then 2.1.312.
const SESSION_LIMIT = "You've hit your session limit · resets 3pm (UTC)";
const FIVE_HOUR_LIMIT = "You've hit your 5-hour limit · resets 3pm (UTC)";
const FAILURES = {
  limited: [429, LIMITED],
  session: [null, SESSION_LIMIT],
  fivehour: [null, FIVE_HOUR_LIMIT],
  mentions: [null, 'The tool reported a usage limit of its own'],
  overloaded: [529, OVERLOADED],
};

describe('a claude API failure', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    // The prompt picks the failure. stderr stays empty and the exit is 1, as the real CLI does.
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
const result = JSON.parse(fs.readFileSync(${JSON.stringify(FIXTURE)}, 'utf8'));
const [status, text] = ${JSON.stringify(FAILURES)}[prompt.trim()];
Object.assign(result, { api_error_status: status, result: text });
process.stdout.write(JSON.stringify(result) + '\\n');
process.exit(1);
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  const drain = async (params) => { for await (const _event of claude.chatStream(params)) { /* drain */ } };

  it('reaches a stream caller with the API\'s message, not the exit code', async () => {
    await assert.rejects(drain({ prompt: 'overloaded', model: 'claude' }), (err) => {
      assert.equal(err.code, 'cli_failed');
      assert.match(err.message, /overloaded_error/);
      assert.doesNotMatch(err.message, /exited with code/);
      return true;
    });
  });

  it('is a 429 on a stream, which the circuit does not count', async () => {
    await assert.rejects(drain({ prompt: 'limited', model: 'claude' }), (err) => err.status === 429 && err.code === 'rate_limited');
  });

  it('is the same 429 without streaming', async () => {
    await assert.rejects(claude.chat({ prompt: 'limited', model: 'claude' }), (err) => err.status === 429 && err.code === 'rate_limited');
  });

  it('carries the status the API answered, for the request log', async () => {
    await assert.rejects(claude.chat({ prompt: 'overloaded', model: 'claude' }), (err) => err.api_error_status === 529);
  });

  for (const [prompt, text] of [['session', SESSION_LIMIT], ['fivehour', FIVE_HOUR_LIMIT]]) {
    it(`is a 429 from the limit message alone: "${text}"`, async () => {
      await assert.rejects(claude.chat({ prompt, model: 'claude' }), (err) => err.status === 429 && err.code === 'rate_limited');
    });
  }

  it('does not read a limit into a message that only mentions one', async () => {
    await assert.rejects(claude.chat({ prompt: 'mentions', model: 'claude' }), (err) => err.code === 'cli_failed');
  });
});
