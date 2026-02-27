const { route, resolveProvider, queue } = require('../router');
const { sanitize } = require('../middleware/sanitize');
const { invalidRequest, fromCatchable, sendOpenAIError } = require('../errors');

const MAX_PROMPT_LENGTH = 50000;

/**
 * Extract system prompt and user prompt from OpenAI messages array.
 * - First message with role "system" becomes the system prompt
 * - Single user message: content used directly as prompt
 * - Multi-turn: non-system messages formatted as "role: content\n" pairs
 */
function extractMessages(messages) {
  let system = null;
  const conversation = [];

  for (const msg of messages) {
    if (msg.role === 'system' && system === null) {
      system = msg.content;
    } else {
      conversation.push(msg);
    }
  }

  let prompt;
  if (conversation.length === 1 && conversation[0].role === 'user') {
    prompt = conversation[0].content;
  } else {
    prompt = conversation.map((m) => `${m.role}: ${m.content}`).join('\n');
  }

  return { prompt, system };
}

/**
 * Validate OpenAI chat completions request body.
 * Returns null if valid, or an error object if invalid.
 */
function validate(body) {
  const { model, messages, max_tokens } = body;

  if (!model) {
    return invalidRequest('Missing required field: model');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return invalidRequest('Missing required field: messages (must be a non-empty array)');
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      return invalidRequest(`messages[${i}] must have string "role" and "content" fields`);
    }
  }

  const hasUser = messages.some((m) => m.role === 'user');
  if (!hasUser) {
    return invalidRequest('messages must contain at least one message with role "user"');
  }

  if (!resolveProvider(model)) {
    return invalidRequest(`Unknown model: ${model}. Use GET /v1/models for available models.`);
  }

  if (max_tokens !== undefined) {
    if (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > 128000) {
      return invalidRequest('Field "max_tokens" must be an integer between 1 and 128000');
    }
  }

  return null;
}

/**
 * POST /v1/chat/completions handler
 */
async function chatCompletionsHandler(req, res) {
  const err = validate(req.body);
  if (err) return sendOpenAIError(res, err);

  const { model, max_tokens } = req.body;

  // Enforce per-key model restrictions
  if (req.allowedModels && req.allowedModels.length > 0) {
    const providerObj = resolveProvider(model);
    const providerName = providerObj ? providerObj.name : null;
    if (!req.allowedModels.includes(model) && (!providerName || !req.allowedModels.includes(providerName))) {
      return sendOpenAIError(res, invalidRequest(
        `Model "${model}" is not allowed for this API key. Allowed: ${req.allowedModels.join(', ')}`
      ));
    }
  }

  let { prompt, system } = extractMessages(req.body.messages);

  // Sanitize extracted text
  prompt = sanitize(prompt);
  if (system) system = sanitize(system);

  // Check prompt length after sanitization
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sendOpenAIError(res, invalidRequest(
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
      id: `shellm-${req.requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.content },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: result.usage?.input_tokens ?? null,
        completion_tokens: result.usage?.output_tokens ?? null,
        total_tokens: result.usage
          ? (result.usage.input_tokens + result.usage.output_tokens)
          : null,
      },
    });
  } catch (catchErr) {
    const errObj = fromCatchable(catchErr, model);
    errObj.duration_ms = Date.now() - startTime;
    sendOpenAIError(res, errObj);
  }
}

module.exports = { chatCompletionsHandler, extractMessages, validate };
