const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execute, buildSafeEnv } = require('../../src/providers/base');

describe('buildSafeEnv', () => {
  it('includes PATH, HOME, TMPDIR, NO_COLOR', () => {
    const env = buildSafeEnv({});
    assert.ok(env.PATH);
    assert.ok(env.HOME);
    assert.ok(env.TMPDIR);
    assert.strictEqual(env.NO_COLOR, '1');
  });

  it('does NOT include SHELLM_AUTH_TOKENS or other secrets', () => {
    // Simulate secrets being in process.env
    const original = process.env.SHELLM_AUTH_TOKENS;
    process.env.SHELLM_AUTH_TOKENS = 'super-secret-token';
    try {
      const env = buildSafeEnv({});
      assert.strictEqual(env.SHELLM_AUTH_TOKENS, undefined);
    } finally {
      if (original === undefined) delete process.env.SHELLM_AUTH_TOKENS;
      else process.env.SHELLM_AUTH_TOKENS = original;
    }
  });

  it('does NOT include CEREBRAS_API_KEY', () => {
    const original = process.env.CEREBRAS_API_KEY;
    process.env.CEREBRAS_API_KEY = 'csk-test-key';
    try {
      const env = buildSafeEnv({});
      assert.strictEqual(env.CEREBRAS_API_KEY, undefined);
    } finally {
      if (original === undefined) delete process.env.CEREBRAS_API_KEY;
      else process.env.CEREBRAS_API_KEY = original;
    }
  });

  it('does NOT include ANTHROPIC_API_KEY', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      const env = buildSafeEnv({});
      assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('does NOT include DATABASE_URL or similar secrets', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'sqlite:///secret/path.db';
    try {
      const env = buildSafeEnv({});
      assert.strictEqual(env.DATABASE_URL, undefined);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it('merges provider-specific vars', () => {
    const env = buildSafeEnv({ CUSTOM_VAR: 'hello' });
    assert.strictEqual(env.CUSTOM_VAR, 'hello');
    assert.strictEqual(env.NO_COLOR, '1');
  });

  it('provider vars override base vars', () => {
    const env = buildSafeEnv({ HOME: '/custom/home' });
    assert.strictEqual(env.HOME, '/custom/home');
  });
});

describe('execute env isolation', () => {
  it('subprocess does NOT see parent process secrets', async () => {
    const original = process.env.SHELLM_AUTH_TOKENS;
    process.env.SHELLM_AUTH_TOKENS = 'leaked-secret';
    try {
      const result = await execute('node', [
        '-e',
        'process.stdout.write(process.env.SHELLM_AUTH_TOKENS || "NOT_FOUND")',
      ]);
      assert.strictEqual(result.stdout, 'NOT_FOUND');
    } finally {
      if (original === undefined) delete process.env.SHELLM_AUTH_TOKENS;
      else process.env.SHELLM_AUTH_TOKENS = original;
    }
  });

  it('subprocess sees PATH', async () => {
    const result = await execute('node', [
      '-e',
      'process.stdout.write(process.env.PATH ? "HAS_PATH" : "NO_PATH")',
    ]);
    assert.strictEqual(result.stdout, 'HAS_PATH');
  });

  it('subprocess sees NO_COLOR=1', async () => {
    const result = await execute('node', [
      '-e',
      'process.stdout.write(process.env.NO_COLOR || "")',
    ]);
    assert.strictEqual(result.stdout, '1');
  });

  it('subprocess sees provider-specific env vars', async () => {
    const result = await execute('node', [
      '-e',
      'process.stdout.write(process.env.MY_PROVIDER_VAR || "")',
    ], { env: { MY_PROVIDER_VAR: 'test-value' } });
    assert.strictEqual(result.stdout, 'test-value');
  });

  it('subprocess does NOT see CEREBRAS_API_KEY without explicit pass', async () => {
    const original = process.env.CEREBRAS_API_KEY;
    process.env.CEREBRAS_API_KEY = 'csk-leaked';
    try {
      const result = await execute('node', [
        '-e',
        'process.stdout.write(process.env.CEREBRAS_API_KEY || "NOT_FOUND")',
      ]);
      assert.strictEqual(result.stdout, 'NOT_FOUND');
    } finally {
      if (original === undefined) delete process.env.CEREBRAS_API_KEY;
      else process.env.CEREBRAS_API_KEY = original;
    }
  });
});
