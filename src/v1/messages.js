const { route, resolveProvider, queue } = require('../router');
const { sanitize } = require('../middleware/sanitize');
const { invalidRequest, fromCatchable, sendAnthropicError } = require('../errors');

const MAX_PROMPT_LENGTH = 50000;

/**
 * Normalize Anthropic content to a plain string.
 * Content can be a string or an array of content blocks.
 * Only text blocks are supported; rejects image/tool_use/etc.
 */
function extractContent(content) {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) {
    return { error: 'content must be a string or array of content blocks' };
  }

  const parts = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block || typeof block !== 'object') {
      return { error: `content[${i}] must be an object` };
    }
    if (block.type !== 'text') {
      return { error: `content[${i}]: only "text" content blocks are supported, got "${block.type}"` };
    }
    if (typeof block.text !== 'string') {
      return { error: `content[${i}].text must be a string` };
    }
    parts.push(block.text);
  }

  return parts.join('\n');
}

/**
 * Convert Anthropic messages + optional top-level system to { prompt, system }.
 * - system comes from the top-level param (not in messages array)
 * - Single user message: content used directly as prompt
 * - Multi-turn: messages formatted as "role: content\n" pairs
 */
function extractPrompt(messages, system) {
  const normalized = [];
  for (const msg of messages) {
    const text = extractContent(msg.content);
    if (typeof text === 'object' && text.error) return text;
    normalized.push({ role: msg.role, content: text });
  }

  let prompt;
  if (normalized.length === 1 && normalized[0].role === 'user') {
    prompt = normalized[0].content;
  } else {
    prompt = normalized.map((m) => `${m.role}: ${m.content}`).join('\n');
  }

  return { prompt, system: system || null };
}

/**
 * Validate Anthropic Messages request body.
 * Returns null if valid, or an error object if invalid.
 */
function validate(body) {
  const { model, messages, max_tokens, stream } = body;

  if (!model) {
    return invalidRequest('Missing required field: model');
  }

  if (stream === true) {
    return invalidRequest('Streaming is not supported. Set stream to false or omit it.');
  }

  if (max_tokens === undefined || max_tokens === null) {
    return invalidRequest('Missing required field: max_tokens');
  }

  if (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > 128000) {
    return invalidRequest('Field "max_tokens" must be an integer between 1 and 128000');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return invalidRequest('Missing required field: messages (must be a non-empty array)');
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg.role !== 'string') {
      return invalidRequest(`messages[${i}] must have a string "role" field`);
    }
    if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
      return invalidRequest(`messages[${i}].content must be a string or array`);
    }
  }

  const hasUser = messages.some((m) => m.role === 'user');
  if (!hasUser) {
    return invalidRequest('messages must contain at least one message with role "user"');
  }

  if (!resolveProvider(model)) {
    return invalidRequest(`Unknown model: ${model}. Use GET /v1/models for available models.`);
  }

  return null;
}

/**
 * POST /v1/messages handler (Anthropic Messages API format)
 */
async function messagesHandler(req, res) {
  const err = validate(req.body);
  if (err) return sendAnthropicError(res, err);

  const { model, max_tokens } = req.body;

  // Enforce per-key model restrictions
  if (req.allowedModels && req.allowedModels.length > 0) {
    const providerObj = resolveProvider(model);
    const providerName = providerObj ? providerObj.name : null;
    if (!req.allowedModels.includes(model) && (!providerName || !req.allowedModels.includes(providerName))) {
      return sendAnthropicError(res, invalidRequest(
        `Model "${model}" is not allowed for this API key. Allowed: ${req.allowedModels.join(', ')}`
      ));
    }
  }

  // Extract and normalize content
  const extracted = extractPrompt(req.body.messages, req.body.system);
  if (extracted.error) {
    return sendAnthropicError(res, invalidRequest(extracted.error));
  }

  let { prompt, system } = extracted;

  // Sanitize extracted text
  prompt = sanitize(prompt);
  if (system) system = sanitize(system);

  // Check prompt length after sanitization
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sendAnthropicError(res, invalidRequest(
      `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${prompt.length})`
    ));
  }

  const startTime = Date.now();
  res.locals.provider = null;
  res.locals.model = model;

  try {
    const result = await route({ model, prompt, system, max_tokens, request_id: req.requestId });
    res.locals.provider = result.provider;
    res.locals.queued_ms = result.queued_ms ?? null;
    res.locals.cost_usd = result.cost_usd ?? null;
    res.locals.usage = result.usage ?? null;

    res.set('X-Queue-Depth', String(queue.stats.pending));
    res.set('X-Queue-Active', String(queue.stats.active));

    res.json({
      id: `msg_shellm-${req.requestId}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: result.content }],
      model: result.model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: result.usage?.input_tokens ?? 0,
        output_tokens: result.usage?.output_tokens ?? 0,
      },
    });
  } catch (catchErr) {
    const errObj = fromCatchable(catchErr, model);
    errObj.duration_ms = Date.now() - startTime;
    sendAnthropicError(res, errObj);
  }
}

module.exports = { messagesHandler, extractContent, extractPrompt, validate };
