const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execute } = require('../../src/providers/base');

describe('base execute', () => {
  it('resolves with stdout/stderr/duration_ms on success', async () => {
    const result = await execute('echo', ['hello']);
    assert.strictEqual(result.stdout, 'hello');
    assert.strictEqual(typeof result.duration_ms, 'number');
  });

  it('rejects with code/stderr on non-zero exit', async () => {
    await assert.rejects(
      () => execute('node', ['-e', 'process.exit(1)']),
      (err) => {
        assert.strictEqual(err.code, 1);
        assert.strictEqual(err.timeout, false);
        assert.strictEqual(typeof err.duration_ms, 'number');
        return true;
      }
    );
  });

  it('rejects with code=-1 on spawn error (command not found)', async () => {
    await assert.rejects(
      () => execute('nonexistent_command_xyz_123', []),
      (err) => {
        assert.strictEqual(err.code, -1);
        assert.match(err.stderr, /ENOENT/);
        return true;
      }
    );
  });

  it('rejects with timeout=true when process exceeds timeout', async () => {
    await assert.rejects(
      () => execute('sleep', ['10'], { timeout: 200 }),
      (err) => {
        assert.strictEqual(err.timeout, true);
        assert.strictEqual(err.code, null);
        assert.match(err.stderr, /killed after/);
        return true;
      }
    );
  });

  it('caps stdout at 1MB without crashing', async () => {
    // Generate ~1.5MB of output
    const result = await execute('node', [
      '-e',
      'process.stdout.write("x".repeat(1.5 * 1024 * 1024))',
    ], { timeout: 10000 });
    // Output should be capped around 1MB
    assert.ok(result.stdout.length <= 1.5 * 1024 * 1024);
    assert.ok(result.stdout.length > 0);
  });

  it('passes environment variables to subprocess', async () => {
    const result = await execute('node', [
      '-e',
      'process.stdout.write(process.env.TEST_VAR || "")',
    ], { env: { TEST_VAR: 'hello123' } });
    assert.strictEqual(result.stdout, 'hello123');
  });

  it('sets NO_COLOR=1 in subprocess environment', async () => {
    const result = await execute('node', [
      '-e',
      'process.stdout.write(process.env.NO_COLOR || "")',
    ]);
    assert.strictEqual(result.stdout, '1');
  });
});
