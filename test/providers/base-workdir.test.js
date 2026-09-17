const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { execute, executeStream } = require('../../src/providers/base');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRINT_CWD = ['-e', 'process.stdout.write(process.cwd())'];

async function waitUntilGone(dir) {
  for (let i = 0; i < 50 && fs.existsSync(dir); i++) await sleep(10);
  return !fs.existsSync(dir);
}

describe('CLI working directory', () => {
  it('runs the CLI outside the SheLLM repository', async () => {
    const { stdout: workdir } = await execute('node', PRINT_CWD);
    assert.ok(path.isAbsolute(workdir));
    assert.ok(!workdir.startsWith(REPO_ROOT), `${workdir} is inside ${REPO_ROOT}`);
  });

  it('gives each request its own directory and removes it afterwards', async () => {
    const [a, b] = await Promise.all([execute('node', PRINT_CWD), execute('node', PRINT_CWD)]);
    assert.notStrictEqual(a.stdout, b.stdout);
    assert.ok(await waitUntilGone(a.stdout));
    assert.ok(await waitUntilGone(b.stdout));
  });

  it('removes the directory when the CLI fails', async () => {
    const script = 'process.stdout.write(process.cwd()); process.exit(3)';
    const err = await execute('node', ['-e', script]).catch((e) => e);
    assert.strictEqual(err.code, 3);
    assert.ok(await waitUntilGone(err.stdout));
  });

  it('streams from outside the repository and cleans up', async () => {
    let workdir = '';
    for await (const event of executeStream('node', PRINT_CWD)) {
      if (event.type === 'chunk') workdir += event.data;
    }
    assert.ok(!workdir.startsWith(REPO_ROOT));
    assert.ok(await waitUntilGone(workdir));
  });
});
