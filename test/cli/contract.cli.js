/**
 * CLI contract tests — spawn the real claude and codex binaries with the exact arguments
 * each provider builds, and fail if a CLI rejects any of them.
 *
 * Needs no login: both CLIs parse their arguments before they authenticate.
 * Run: npm run test:cli (the CLIs must be on PATH). Output formats need a login and are
 * covered by npm run test:e2e.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claude = require('../../src/providers/claude');
const codex = require('../../src/providers/codex');

// commander (claude) and clap (codex) usage errors
const REJECTED = /unknown option|unknown arguments?:|unexpected argument|invalid value|missing required argument/i;
const SETTLE_MS = 20000;

const request = {
  prompt: 'ping',
  system: 'Reply in one word.',
  temperature: 0.5,
  response_format: { type: 'json_object' },
};

const schemaRequest = {
  ...request,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'word', schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false } },
  },
};

let home;

before(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-cli-contract-')); });
after(() => { fs.rmSync(home, { recursive: true, force: true }); });

function run(command, args) {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir(), NO_COLOR: '1' },
      detached: true,
    });
    const collect = (chunk) => { output += chunk; };
    proc.stdout.on('data', collect);
    proc.stderr.on('data', collect);

    // Still running after SETTLE_MS means the arguments were accepted and it is waiting on auth or network
    const timer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already exited */ }
    }, SETTLE_MS);

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

async function assertAccepted(command, args) {
  const { output } = await run(command, args);
  assert.doesNotMatch(output, REJECTED, `${command} rejected its arguments:\n${output.slice(0, 1000)}`);
}

async function assertRejected(command, args) {
  const { output } = await run(command, args);
  assert.match(output, REJECTED, `${command} accepted a bogus flag, so this suite cannot detect rejections:\n${output.slice(0, 1000)}`);
}

describe('claude CLI contract', () => {
  it('accepts the chat arguments', () => assertAccepted('claude', claude.buildArgs(request)));
  it('accepts the stream arguments', () => assertAccepted('claude', claude.buildStreamArgs(request)));
  it('accepts the json_schema arguments', () => assertAccepted('claude', claude.buildArgs(schemaRequest)));
  it('rejects an unknown flag', () => assertRejected('claude', ['--print', '--shellm-bogus-flag', '--', 'ping']));
});

describe('codex CLI contract', () => {
  it('accepts the chat arguments', () => assertAccepted('codex', codex.buildArgs(request)));
  it('accepts the json_schema arguments', () => assertAccepted('codex', codex.buildArgs(schemaRequest)));
  it('rejects an unknown flag', () => assertRejected('codex', ['exec', '--shellm-bogus-flag', 'ping']));
});
