const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// What Knotty caught: the model's first StructuredOutput call carried a literal $PARAMETER_NAME,
// the CLI asked again, and both attempts' input_json_delta reached the stream.
const delta = (partial_json) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } } });
const LINES = [
  delta('{"$PARAMETER_NAME": "{\\"piezas\\": [{\\"nombre\\": '),
  delta('\\"lateral\\"}]}"}'),
  delta('{"piezas": [{"nombre": '),
  delta('"lateral"}]}'),
  { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 40 }, structured_output: { piezas: [{ nombre: 'lateral' }] } },
];

describe('a schema answer the model got right only on its second attempt', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
require('fs').readFileSync(0);
process.stdout.write(${JSON.stringify(LINES.map((line) => JSON.stringify(line)).join('\n') + '\n')});
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('streams only the validated output, once, and never the failed attempt', async () => {
    const response_format = { type: 'json_schema', json_schema: { name: 'plan', schema: { type: 'object' } } };
    const deltas = [];
    for await (const event of claude.chatStream({ prompt: 'x', model: 'claude', response_format })) {
      if (event.type === 'delta') deltas.push(event.content);
    }

    assert.equal(deltas.length, 1);
    assert.deepEqual(JSON.parse(deltas[0]), { piezas: [{ nombre: 'lateral' }] });
    assert.ok(!deltas.join('').includes('$PARAMETER_NAME'));
  });
});
