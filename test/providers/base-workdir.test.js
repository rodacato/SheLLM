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

  describe('request files and stdin', () => {
    const READ_FILE = ['-e', `
      const fs = require('fs');
      const st = fs.statSync('req.bin');
      process.stdout.write(JSON.stringify({ cwd: process.cwd(), mode: st.mode & 0o777, bytes: fs.readFileSync('req.bin').length }));
    `];

    it('writes each file into the request directory, readable only by this user', async () => {
      const { stdout } = await execute('node', READ_FILE, { files: { 'req.bin': Buffer.alloc(1024, 7) } });
      const seen = JSON.parse(stdout);
      assert.equal(seen.mode, 0o600);
      assert.equal(seen.bytes, 1024);
      assert.ok(await waitUntilGone(seen.cwd));
    });

    it('removes the files when the CLI fails', async () => {
      const script = 'process.stdout.write(process.cwd()); process.exit(2)';
      const err = await execute('node', ['-e', script], { files: { 'req.bin': 'x' } }).catch((e) => e);
      assert.equal(err.code, 2);
      assert.ok(await waitUntilGone(err.stdout));
    });

    it('removes the files when a stream is cancelled mid-run', async () => {
      const ac = new AbortController();
      const script = 'process.stdout.write(process.cwd() + "\\n"); setInterval(() => {}, 1000)';
      let workdir = '';
      for await (const event of executeStream('node', ['-e', script], { files: { 'req.bin': 'x' }, signal: ac.signal })) {
        if (event.type !== 'chunk') continue;
        workdir += event.data;
        assert.ok(fs.existsSync(path.join(workdir.trim(), 'req.bin')));
        ac.abort();
      }
      assert.ok(await waitUntilGone(workdir.trim()));
    });

    it('writes the input to stdin and closes it', async () => {
      const echo = ['-e', 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => process.stdout.write(s))'];
      const { stdout } = await execute('node', echo, { input: '{"type":"user"}\n' });
      assert.equal(stdout, '{"type":"user"}');
    });

    it('keeps stdin closed when no input is given', async () => {
      const probe = ['-e', 'process.stdout.write(String(require("fs").fstatSync(0).isFIFO()))'];
      const { stdout } = await execute('node', probe);
      assert.equal(stdout, 'false');
    });
  });
});

describe('a stream that did not finish on its own', () => {
  const HANG = ['-e', 'process.stdout.write("partial"); setInterval(() => {}, 1000)'];

  it('fails with a timeout instead of ending as if it had finished', async () => {
    const seen = [];
    await assert.rejects(async () => {
      for await (const event of executeStream('node', HANG, { timeout: 300 })) seen.push(event.type);
    }, (err) => err.timeout === true && /killed after 300ms/.test(err.stderr));
    assert.ok(seen.includes('chunk'), 'what arrived before the kill still arrives');
    assert.ok(!seen.includes('done'), 'a killed stream must never report done');
  });

  it('fails when the process dies to a signal nobody sent on purpose', async () => {
    const script = ['-e', 'process.stdout.write("partial"); setTimeout(() => process.kill(process.pid, "SIGKILL"), 50)'];
    await assert.rejects(async () => {
      for await (const _event of executeStream('node', script)) { /* drain */ }
    }, /killed by SIGKILL/);
  });

  it('ends quietly when the caller aborted, since nobody is left to tell', async () => {
    const ac = new AbortController();
    for await (const event of executeStream('node', HANG, { signal: ac.signal })) {
      if (event.type === 'chunk') ac.abort();
    }
  });
});
