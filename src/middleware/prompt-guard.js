'use strict';

const logger = require('../lib/logger');

/**
 * Pattern-based prompt injection detection.
 *
 * Two tiers:
 *   Tier 1 — High-confidence patterns: attempts to override system instructions,
 *            execute system commands, or access sensitive files.
 *   Tier 2 — Heuristic patterns: obfuscation techniques, encoding tricks,
 *            and social engineering phrases commonly used in prompt injection.
 *
 * Each pattern has a name (for logging), a regex, and a tier.
 * Tier 1 matches block immediately. Tier 2 matches accumulate — blocking
 * when 2+ distinct Tier 2 patterns trigger in the same prompt.
 */

const TIER1_PATTERNS = [
  // --- System command execution ---
  {
    name: 'shell_command',
    re: /(?:^|\s)(?:sudo|chmod|chown|rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|kill\s+-9|systemctl|journalctl)\b/i,
  },
  {
    name: 'file_system_access',
    re: /(?:\/etc\/(?:passwd|shadow|hosts|sudoers)|\/proc\/|\/sys\/|~\/\.(?:ssh|bashrc|bash_history|gnupg|config)|\/var\/log)/i,
  },
  {
    name: 'env_exfiltration',
    re: /(?:print|echo|cat|dump|show|list|read|output|reveal|display)\s+(?:\w+\s+)*(?:env(?:ironment)?(?:\s+var(?:iable)?s?)?|process\.env|API.?KEY|SECRET|TOKEN|CREDENTIALS?|PASSWORD)/i,
  },
  {
    name: 'code_execution_directive',
    re: /(?:execute|run|eval|spawn|exec)\s+(?:this\s+)?(?:shell|bash|sh|command|script|code|system)/i,
  },
  {
    name: 'network_exfiltration',
    re: /(?:curl|wget|fetch|nc|netcat|ncat)\s+(?:https?:\/\/|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i,
  },

  // --- Role/instruction override ---
  {
    name: 'role_override',
    re: /(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:your\s+)?(?:previous|prior|above|earlier|system|initial)\s+(?:instructions?|prompts?|rules?|constraints?|directives?|guidelines?)/i,
  },
  {
    name: 'new_identity',
    re: /(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as\s+if\s+you\s+are|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as|switch\s+to\s+(?:being|acting\s+as))\s+(?:a\s+)?(?:\w+\s+)*(?:different|new|unrestricted|unfiltered|jailbroken|DAN\b)/i,
  },
  {
    name: 'system_prompt_leak',
    re: /(?:reveal|show|print|output|display|repeat|recite|echo)\s+(?:\w+\s+)*(?:system\s+prompt|system\s+message|hidden\s+instructions?|initial\s+prompt|developer\s+(?:instructions?|message))/i,
  },

  // --- File write/modification ---
  {
    name: 'file_write',
    re: /(?:write|append|create|modify|overwrite|replace|edit)\s+(?:\w+\s+)*(?:file|\/[\w/.-]+|~\/)/i,
  },
];

const TIER2_PATTERNS = [
  // --- Obfuscation / encoding tricks ---
  {
    name: 'base64_injection',
    re: /(?:decode|base64|atob|Buffer\.from)\s*[\(]/i,
  },
  {
    name: 'unicode_obfuscation',
    re: /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/,
  },
  {
    name: 'hex_escape_sequence',
    re: /(?:\\x[0-9a-fA-F]{2}){4,}/,
  },
  {
    name: 'character_splitting',
    re: /(?:combine|concatenate|join|merge)\s+(?:these\s+)?(?:characters?|letters?|parts?|fragments?|pieces?)/i,
  },

  // --- Social engineering ---
  {
    name: 'developer_mode',
    re: /(?:enable|enter|activate|switch\s+to)\s+(?:developer|debug|admin|maintenance|god|sudo|root|unrestricted)\s+mode/i,
  },
  {
    name: 'hypothetical_framing',
    re: /(?:hypothetically|theoretically|in\s+a\s+fictional|for\s+a\s+(?:novel|story|movie|game))[,.]?\s+(?:\w+\s+)*(?:if|how\s+would|what\s+if|could\s+you|would\s+you|can\s+you)/i,
  },
  {
    name: 'authority_claim',
    re: /(?:i\s+am\s+(?:the\s+)?(?:admin|developer|owner|root|superuser|ceo|cto)|(?:as\s+)?(?:the\s+)?admin(?:istrator)?\s+i\s+(?:authorize|order|command|instruct))/i,
  },
  {
    name: 'safety_bypass',
    re: /(?:disable|turn\s+off|remove|ignore)\s+(?:your\s+)?(?:safety|content\s+filter|guardrail|restriction|limitation|censorship)/i,
  },

  // --- Prompt structure manipulation ---
  {
    name: 'fake_delimiter',
    re: /(?:---\s*(?:END|BEGIN)\s+(?:SYSTEM|INSTRUCTIONS?|CONTEXT)\s*---|<\/?(?:system|instruction|admin|override)>|\[SYSTEM\]|\[ADMIN\])/i,
  },
  {
    name: 'markdown_injection',
    re: /!\[.*?\]\(https?:\/\/[^)]+\)/,
  },
];

const TIER2_THRESHOLD = 2;

/**
 * Normalize text before scanning: collapse whitespace tricks,
 * strip zero-width characters, lowercase.
 */
function normalize(text) {
  return text
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '') // zero-width chars
    .replace(/\s+/g, ' ');                                       // collapse whitespace
}

/**
 * Analyze a prompt for injection patterns.
 *
 * @param {string} text - The prompt text to analyze
 * @returns {{ safe: boolean, tier1: string[], tier2: string[] }}
 */
function analyzePrompt(text) {
  if (!text || typeof text !== 'string') return { safe: true, tier1: [], tier2: [] };

  const normalized = normalize(text);

  const tier1 = [];
  for (const pattern of TIER1_PATTERNS) {
    if (pattern.re.test(text) || pattern.re.test(normalized)) {
      tier1.push(pattern.name);
    }
  }

  const tier2 = [];
  for (const pattern of TIER2_PATTERNS) {
    if (pattern.re.test(text) || pattern.re.test(normalized)) {
      tier2.push(pattern.name);
    }
  }

  const safe = tier1.length === 0 && tier2.length < TIER2_THRESHOLD;
  return { safe, tier1, tier2 };
}

/**
 * Guard middleware — analyzes prompt + system fields.
 * If unsafe, logs the event and returns a result object.
 * Does NOT send a response (caller decides how to handle).
 *
 * @param {string} prompt
 * @param {string} [system]
 * @param {{ request_id?: string, client?: string }} [meta]
 * @returns {{ blocked: boolean, reason?: string, patterns?: string[] } }
 */
function guardPrompt(prompt, system, meta = {}) {
  const promptResult = analyzePrompt(prompt);
  const systemResult = system ? analyzePrompt(system) : { safe: true, tier1: [], tier2: [] };

  const allTier1 = [...promptResult.tier1, ...systemResult.tier1];
  // Deduplicate tier2 patterns across prompt + system
  const allTier2 = [...new Set([...promptResult.tier2, ...systemResult.tier2])];

  const blocked = allTier1.length > 0 || allTier2.length >= TIER2_THRESHOLD;
  if (!blocked) {
    return { blocked: false };
  }

  const allPatterns = [...allTier1, ...allTier2];
  const reason = allTier1.length > 0
    ? 'prompt_injection_detected'
    : 'suspicious_content';

  logger.warn({
    event: 'prompt_blocked',
    reason,
    patterns: allPatterns,
    request_id: meta.request_id || null,
    client: meta.client || null,
  });

  return { blocked: true, reason, patterns: allPatterns };
}

module.exports = { analyzePrompt, guardPrompt, normalize, TIER1_PATTERNS, TIER2_PATTERNS, TIER2_THRESHOLD };
