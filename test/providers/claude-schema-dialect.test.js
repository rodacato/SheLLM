const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// What Zod 4's z.toJSONSchema() emits: it names draft 2020-12, which the CLI's validator does not know.
const zodSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};
const response_format = (schema) => ({ type: 'json_schema', json_schema: { name: 'pack_part', strict: false, schema } });

// The CLI's own refusal, captured from 2.1.302 on 2026-10-17.
const REFUSAL = 'Error: --json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"';

describe('a JSON schema that names its dialect', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
require('fs').readFileSync(0);
process.stderr.write(${JSON.stringify(REFUSAL)} + '\\n');
process.exit(1);
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  function schemaArg(args) {
    return JSON.parse(args[args.indexOf('--json-schema') + 1]);
  }

  it('reaches the CLI without the dialect tag and with every constraint kept', () => {
    const { $schema: _, ...constraints } = zodSchema;
    for (const args of [claude.buildArgs({ prompt: 'x', response_format: response_format(zodSchema) }), claude.buildStreamArgs({ prompt: 'x', response_format: response_format(zodSchema) })]) {
      assert.deepEqual(schemaArg(args), constraints);
    }
  });

  it('is a 400 when the CLI still refuses a schema, so a caller\'s schema never trips the circuit', async () => {
    await assert.rejects(claude.chat({ prompt: 'x', response_format: response_format({ type: 'object' }) }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'invalid_request');
      assert.match(err.message, /not a valid JSON Schema/);
      return true;
    });
  });

  it('is the same 400 on a stream', async () => {
    const drain = async () => { for await (const _event of claude.chatStream({ prompt: 'x', response_format: response_format({ type: 'object' }) })) { /* drain */ } };
    await assert.rejects(drain(), (err) => err.status === 400 && err.code === 'invalid_request');
  });
});
