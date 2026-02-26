const { execute } = require('./providers/base');
const { queue } = require('./router');

async function checkCLI(name, command, testArgs, { timeout = 10000 } = {}) {
  try {
    await execute(command, testArgs, { timeout });
    return { installed: true, authenticated: true };
  } catch (err) {
    const stderr = err.stderr || '';
    if (err.code === -1 || stderr.includes('not found') || stderr.includes('ENOENT')) {
      return { installed: false, authenticated: false };
    }
    if (stderr.includes('not authenticated') || stderr.includes('login') || stderr.includes('auth')) {
      return { installed: true, authenticated: false };
    }
    // CLI is installed but returned an error — could be auth or other issue
    return { installed: true, authenticated: false, error: stderr.slice(0, 200) };
  }
}

async function checkCerebras() {
  if (!process.env.CEREBRAS_API_KEY) {
    return { installed: true, authenticated: false, error: 'CEREBRAS_API_KEY not set' };
  }
  return { installed: true, authenticated: true };
}

async function getHealthStatus() {
  const [claudeStatus, geminiStatus, codexStatus, cerebrasStatus] = await Promise.all([
    checkCLI('claude', 'claude', ['--version']),
    checkCLI('gemini', 'gemini', ['--version']),
    checkCLI('codex', 'codex', ['--version']),
    checkCerebras(),
  ]);

  return {
    status: 'ok',
    providers: {
      claude: claudeStatus,
      gemini: geminiStatus,
      codex: codexStatus,
      cerebras: cerebrasStatus,
    },
    queue: queue.stats,
    uptime_seconds: Math.floor(process.uptime()),
  };
}

module.exports = { getHealthStatus };
