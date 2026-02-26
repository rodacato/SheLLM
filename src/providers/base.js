const { spawn } = require('node:child_process');

const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '120000', 10);

/**
 * Execute a CLI command as a subprocess with timeout.
 * Stdin is ignored to prevent hanging on interactive prompts.
 */
function execute(command, args, { timeout = TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd || undefined,
      env: { ...process.env, NO_COLOR: '1', ...env },
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject({
        code: null,
        stdout,
        stderr: `Process killed after ${timeout}ms`,
        duration_ms: Date.now() - startTime,
        timeout: true,
      });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - startTime;
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), duration_ms });
      } else {
        reject({ code, stdout, stderr: stderr.trim(), duration_ms, timeout: false });
      }
    });

    proc.on('error', (err) => {
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
