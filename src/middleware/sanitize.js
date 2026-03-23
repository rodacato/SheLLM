const { guardPrompt } = require('./prompt-guard');

function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')       // Strip null bytes
    .replace(/\r/g, '');      // Normalize line endings
}

/**
 * Run prompt guard on prompt + system. Returns null if safe,
 * or { reason, patterns } if blocked.
 */
function checkPromptSafety(prompt, system, meta) {
  if (process.env.SHELLM_PROMPT_GUARD === 'false') return null;
  const result = guardPrompt(prompt, system, meta);
  if (result.blocked) return { reason: result.reason, patterns: result.patterns };
  return null;
}

module.exports = { sanitize, checkPromptSafety };
