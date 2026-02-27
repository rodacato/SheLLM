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
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd || undefined,
      env: { ...process.env, NO_COLOR: '1', ...env },
    });

    proc.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk;
      } else {
        stdoutTruncated = true;
      }
    });

    proc.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk;
      } else {
        stderrTruncated = true;
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

module.exports = { execute };
