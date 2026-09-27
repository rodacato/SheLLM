'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The landing page's request inspector shows argv, CLI events, responses and log rows. None of it
// is typed by hand: this test produces it by running each scenario through the app against CLIs
// that replay recorded output, and fails when the page's copy no longer matches.
// INSPECTOR_WRITE=1 npm test -- test/site/inspector.test.js rewrites the page's copy instead.

const ROOT = path.join(__dirname, '../..');
const DATA = path.join(ROOT, 'site/inspector.json');
const FIXTURES = path.join(ROOT, 'test/fixtures');

const CLAUDE_STREAM = 'claude/2.1.273/stream-json.jsonl';
const CODEX_SCHEMA = 'codex/0.154.0/exec-json-output-schema.jsonl';

// Line numbers (0-based) of the recording the page shows. The ones left out are the CLI's session
// preamble and a duplicate of the streamed text.
const CLAUDE_EVENTS = [3, 4, 5, 6, 8, 9, 10, 11];
const CODEX_EVENTS = [0, 1, 2, 3];

const COUNT = 'Count to 5, one number per line.';
const SCHEMA = {
  type: 'object',
  properties: { color: { type: 'string' }, shape: { type: 'string' } },
  required: ['color', 'shape'],
  additionalProperties: false,
};

const SCENARIOS = [
  {
    id: 'openai-stream',
    label: 'OpenAI SDK · streaming',
    api: 'openai',
    engine: 'claude',
    fixture: CLAUDE_STREAM,
    lines: CLAUDE_EVENTS,
    request: {
      method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer $SHELLM_KEY' },
      body: { model: 'claude-opus', stream: true, messages: [{ role: 'user', content: COUNT }] },
    },
  },
  {
    id: 'anthropic-stream',
    label: 'Anthropic SDK · streaming',
    api: 'anthropic',
    engine: 'claude',
    fixture: CLAUDE_STREAM,
    lines: CLAUDE_EVENTS,
    request: {
      method: 'POST', path: '/v1/messages', headers: { 'x-api-key': '$SHELLM_KEY', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-opus', max_tokens: 1024, stream: true, messages: [{ role: 'user', content: COUNT }] },
    },
  },
  {
    id: 'codex-schema',
    label: 'json_schema · codex',
    api: 'openai',
    engine: 'codex',
    fixture: CODEX_SCHEMA,
    lines: CODEX_EVENTS,
    request: {
      method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer $SHELLM_KEY' },
      body: {
        model: 'codex',
        messages: [{ role: 'user', content: 'Pick a color and a shape.' }],
        response_format: { type: 'json_schema', json_schema: { name: 'pick', strict: true, schema: SCHEMA } },
      },
    },
  },
  {
    id: 'tools-refused',
    label: 'tools · refused',
    api: 'openai',
    engine: null,
    request: {
      method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer $SHELLM_KEY' },
      body: {
        model: 'claude-opus',
        messages: [{ role: 'user', content: 'What is the weather in Colima?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
      },
    },
  },
];

const fixtureLines = (file) => fs.readFileSync(path.join(FIXTURES, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

// Ids, timestamps and SheLLM's own timing fields change on every run; the shape and the text do not.
const VOLATILE = new Set(['id', 'created', 'shellm', 'x_shellm']);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !VOLATILE.has(key)).map(([key, v]) => [key, stable(v)]));
  }
  return value;
}

function parseSse(text) {
  return text.trim().split('\n\n').map((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)[1];
    const parsed = data === '[DONE]' ? '[DONE]' : stable(JSON.parse(data));
    return event ? { event, data: parsed } : { data: parsed };
  });
}

describe('the request inspector on the landing page', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let request;
  let app;
  let key;
  let getDb;
  const captured = [];

  function writeCli(cli, body) {
    fs.writeFileSync(path.join(fakeBin, cli), `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const log = ${JSON.stringify(path.join(fakeBin, 'spawns'))};
${body}
`, { mode: 0o755 });
  }

  const replay = (file) => `let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(log, JSON.stringify({ args, stdin }) + '\\n');
  process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(FIXTURES, file))}));
});`;

  before(async () => {
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-inspector-'));
    writeCli('claude', `if (args[0] === '--version') { process.stdout.write('2.1.273 (Claude Code)'); return; }
if (args[0] === 'auth') { process.stdout.write('{"loggedIn":true}'); return; }
if (args.includes('/model')) return;
${replay(CLAUDE_STREAM)}`);
    writeCli('codex', `if (args[0] === '--version') { process.stdout.write('codex-cli 0.154.0'); return; }
if (args[0] === 'login') { process.stdout.write('Logged in using ChatGPT'); return; }
if (args[0] === 'app-server') { process.stdout.write('{"id":1,"result":null}\\n'); return; }
${replay(CODEX_SCHEMA)}`);

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    // The page shows the defaults; a developer's own config file would change the argv.
    process.env.XDG_CONFIG_HOME = fakeBin;
    for (const k of Object.keys(require.cache)) {
      if (k.includes('/src/')) delete require.cache[k];
    }
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');

    const db = require('../../src/db');
    db.initDb(':memory:');
    getDb = db.getDb;
    key = require('../../src/db/clients').createClient({ name: 'blog-pipeline', rpm: 100 }).rawKey;
    request = require('supertest');
    app = require('../../src/server');

    for (const scenario of SCENARIOS) captured.push(await run(scenario));
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.XDG_CONFIG_HOME;
    require('../../src/db').closeDb();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  async function run(scenario) {
    const spawns = path.join(fakeBin, 'spawns');
    fs.writeFileSync(spawns, '');

    let call = request(app).post(scenario.request.path).set('content-type', 'application/json');
    for (const [name, value] of Object.entries(scenario.request.headers)) call = call.set(name, value.replace('$SHELLM_KEY', key));
    const res = await call.buffer(true).parse((r, done) => {
      let text = '';
      r.on('data', (chunk) => { text += chunk; });
      r.on('end', () => done(null, text));
    }).send(scenario.request.body);

    const spawn = fs.readFileSync(spawns, 'utf8').trim();
    const cli = spawn ? JSON.parse(spawn) : null;
    const row = getDb().prepare('SELECT client_name, provider, model, status, streamed, tokens_in, tokens_out, cost_usd, error_code, method, path FROM request_logs ORDER BY id DESC LIMIT 1').get();
    const events = scenario.fixture ? fixtureLines(scenario.fixture) : [];

    return {
      id: scenario.id,
      label: scenario.label,
      api: scenario.api,
      engine: scenario.engine,
      request: scenario.request,
      argv: cli ? [scenario.engine, ...cli.args] : null,
      stdin: cli ? cli.stdin : null,
      fixture: scenario.fixture || null,
      events: (scenario.lines || []).map((i) => events[i]),
      status: res.status,
      response: scenario.request.body.stream ? { sse: parseSse(res.body) } : { json: stable(JSON.parse(res.body)) },
      log: { ...row, streamed: !!row.streamed },
    };
  }

  it('matches what the app produces today', () => {
    const produced = { generated_by: 'test/site/inspector.test.js', scenarios: captured };
    if (process.env.INSPECTOR_WRITE) fs.writeFileSync(DATA, JSON.stringify(produced, null, 2) + '\n');
    const onPage = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    assert.deepEqual(onPage, produced, 'site/inspector.json is stale — rerun with INSPECTOR_WRITE=1 and review the diff');
  });

  it('shows only CLI events that are lines of a recording', () => {
    for (const scenario of captured) {
      const recorded = scenario.fixture ? fixtureLines(scenario.fixture) : [];
      for (const event of scenario.events) {
        assert.ok(recorded.some((line) => JSON.stringify(line) === JSON.stringify(event)), `${scenario.id} shows an event no recording holds`);
      }
    }
  });

  it('runs claude isolated, on the 1M variant, whichever API the request came in on', () => {
    const [openai, anthropic] = captured;
    assert.deepEqual(openai.argv, anthropic.argv, 'the two formats should reach the CLI identically');
    const { ISOLATION_ARGS } = require('../../src/providers/claude');
    const argv = openai.argv.join(' ');
    assert.ok(argv.includes(ISOLATION_ARGS.join(' ')), 'the isolation flags are not all there');
    assert.ok(argv.includes('--model opus[1m]'));
  });

  it('refuses tools before any CLI starts', () => {
    const refused = captured.find((s) => s.id === 'tools-refused');
    assert.equal(refused.status, 400);
    assert.equal(refused.argv, null);
    assert.equal(refused.response.json.error.param, 'tools');
  });
});
