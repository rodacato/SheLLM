const { spawn } = require('node:child_process');

const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '120000', 10);
const MAX_OUTPUT = 1024 * 1024; // 1MB cap on stdout/stderr

/**
 * Execute a CLI command as a subprocess with timeout.
 * Stdin is ignored to prevent hanging on interactive prompts.
 */
function execute(command, args, { timeout = TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let _stdoutTruncated = false;
    let _stderrTruncated = false;

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd || undefined,
      env: { ...process.env, NO_COLOR: '1', ...env },
    });

    proc.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk;
      } else {
        _stdoutTruncated = true;
      }
    });

    proc.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk;
      } else {
        _stderrTruncated = true;
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      // Graceful: SIGTERM first, then SIGKILL after 5s
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000).unref();
      settled = true;
      reject({
        code: null,
        stdout,
        stderr: `Process killed after ${timeout}ms`,
        duration_ms: Date.now() - startTime,
        timeout: true,
      });
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const duration_ms = Date.now() - startTime;
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), duration_ms });
      } else {
        reject({ code, stdout, stderr: stderr.trim(), duration_ms, timeout: false });
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject({
        code: -1,
        stdout: '',
        stderr: err.message,
        duration_ms: Date.now() - startTime,
        timeout: false,
      });
    });
  });
}

/**
 * Execute a CLI command and yield stdout chunks as they arrive.
 * Accepts an AbortSignal for client disconnect cleanup.
 */
async function* executeStream(command, args, { timeout = TIMEOUT_MS, cwd, env, signal } = {}) {
  const proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: cwd || undefined,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_OUTPUT) stderr += chunk;
  });

  // Kill subprocess on abort (client disconnect)
  if (signal) {
    const onAbort = () => { proc.kill('SIGTERM'); };
    signal.addEventListener('abort', onAbort, { once: true });
    proc.on('close', () => signal.removeEventListener('abort', onAbort));
  }

  // Timeout safety net
  const timer = setTimeout(() => {
    proc.kill('SIGTERM');
    setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000).unref();
  }, timeout);

  // Convert stdout events to an async iterable via a queue
  const chunks = [];
  let resolve = null;
  let done = false;
  let exitCode = null;

  proc.stdout.on('data', (chunk) => {
    chunks.push(chunk.toString());
    if (resolve) { resolve(); resolve = null; }
  });

  proc.on('close', (code) => {
    clearTimeout(timer);
    exitCode = code;
    done = true;
    if (resolve) { resolve(); resolve = null; }
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    stderr = err.message;
    exitCode = -1;
    done = true;
    if (resolve) { resolve(); resolve = null; }
  });

  while (true) {
    while (chunks.length > 0) {
      yield { type: 'chunk', data: chunks.shift() };
    }
    if (done) break;
    await new Promise((r) => { resolve = r; });
  }

  // Drain any remaining chunks
  while (chunks.length > 0) {
    yield { type: 'chunk', data: chunks.shift() };
  }

  if (exitCode !== 0 && exitCode !== null) {
    const err = new Error(`Process exited with code ${exitCode}`);
    err.code = exitCode;
    err.stderr = stderr.trim();
    throw err;
  }

  yield { type: 'done', stderr: stderr.trim() };
}

module.exports = { execute, executeStream };
