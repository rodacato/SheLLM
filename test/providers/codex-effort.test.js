const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const codex = require('../../src/providers/codex');

const configValue = (args, key) => args.find((arg, i) => args[i - 1] === '-c' && arg.startsWith(`${key}=`));

describe('reasoning effort reaches each CLI in its own terms', () => {
  it('hands codex the level it was given', () => {
    for (const effort of ['low', 'medium', 'high']) {
      const args = codex.buildArgs({ prompt: 'ping', model: 'codex', effort });
      assert.equal(configValue(args, 'model_reasoning_effort'), `model_reasoning_effort="${effort}"`);
      assert.equal(args.at(-1), 'ping', 'the prompt stays last');
    }
  });

  it('leaves codex on its own configuration when the request names no level', () => {
    const args = codex.buildArgs({ prompt: 'ping', model: 'codex' });
    assert.equal(configValue(args, 'model_reasoning_effort'), undefined);
  });
});
