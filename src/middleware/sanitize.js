const { guardPrompt } = require('./prompt-guard');
const logger = require('../lib/logger');

// Warn at module load if prompt guard is explicitly disabled
if (process.env.SHELLM_PROMPT_GUARD === 'DISABLED_UNSAFE') {
  logger.warn({ event: 'prompt_guard_disabled', message: 'Prompt guard is DISABLED. All prompts will pass without safety checks.' });
}

function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')                                            // canonical + compat decomposition
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '')    // strip zero-width chars
    .replace(/\0/g, '')                                            // strip null bytes
    .replace(/\r/g, '');                                           // normalize line endings
}

/**
 * Run prompt guard on prompt + system. Returns null if safe,
 * or { reason, patterns } if blocked.
 *
 * Disable options:
 *   - SHELLM_PROMPT_GUARD=DISABLED_UNSAFE  → disables in any environment
 *   - SHELLM_PROMPT_GUARD=false            → disables in development only
 *   - In production, 'false' is NOT sufficient — use DISABLED_UNSAFE
 */
function checkPromptSafety(prompt, system, meta) {
  const guardSetting = process.env.SHELLM_PROMPT_GUARD;

  // Explicit unsafe opt-out — works in any environment
  if (guardSetting === 'DISABLED_UNSAFE') return null;

  // 'false' only works in non-production
  if (guardSetting === 'false' && process.env.NODE_ENV !== 'production') return null;

  // Per-client safety level override
  const safetyLevel = meta?.safetyLevel || 'strict';
  if (safetyLevel === 'permissive') {
    logger.warn({
      event: 'prompt_guard_bypassed',
      client: meta?.client || null,
      safety_level: 'permissive',
      request_id: meta?.request_id || null,
    });
    return null;
  }

  // 'standard' raises Tier 2 threshold from 2 to 3
  const tier2Override = safetyLevel === 'standard' ? 3 : undefined;
  const result = guardPrompt(prompt, system, meta, tier2Override);
  if (result.blocked) return { reason: result.reason, patterns: result.patterns };
  return null;
}

module.exports = { sanitize, checkPromptSafety };
