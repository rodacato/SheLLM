const { route, resolveProvider, queue } = require('../router');
const { sanitize } = require('../middleware/sanitize');
const { invalidRequest, fromCatchable, sendOpenAIError } = require('../errors');
const { initSSE, sendSSEChunk, sendSSEDone, sendSSEError } = require('../lib/sse');

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

  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) {
      return invalidRequest('Field "temperature" must be a number between 0 and 2');
    }
  }

  return null;
}

/**
 * Common pre-flight: validate, enforce model restrictions, sanitize.
 * Returns { model, max_tokens, prompt, system } or sends error and returns null.
 */
function preflight(req, res) {
  const err = validate(req.body);
  if (err) { sendOpenAIError(res, err); return null; }

  const { model, max_tokens, temperature } = req.body;

  if (req.allowedModels && req.allowedModels.length > 0) {
    const providerObj = resolveProvider(model);
    const providerName = providerObj ? providerObj.name : null;
    if (!req.allowedModels.includes(model) && (!providerName || !req.allowedModels.includes(providerName))) {
      sendOpenAIError(res, invalidRequest(
        `Model "${model}" is not allowed for this API key. Allowed: ${req.allowedModels.join(', ')}`
      ));
      return null;
    }
  }

  let { prompt, system } = extractMessages(req.body.messages);
  prompt = sanitize(prompt);
  if (system) system = sanitize(system);

  if (prompt.length > MAX_PROMPT_LENGTH) {
    sendOpenAIError(res, invalidRequest(
      `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${prompt.length})`
    ));
    return null;
  }

  return { model, max_tokens, temperature, prompt, system };
}

/**
 * POST /v1/chat/completions handler
 */
async function chatCompletionsHandler(req, res) {
  const params = preflight(req, res);
  if (!params) return;

  if (req.body.stream === true) {
    return handleStream(req, res, params);
  }

  const { model, max_tokens, temperature, prompt, system } = params;
  const startTime = Date.now();
  res.locals.provider = null;
  res.locals.model = model;

  try {
    const result = await route({ model, prompt, system, max_tokens, temperature, request_id: req.requestId });
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

/**
 * Handle streaming response (stream: true).
 * Holds a queue slot for the full stream duration.
 */
async function handleStream(req, res, { model, max_tokens, temperature, prompt, system }) {
  const logger = require('../lib/logger');
  const provider = resolveProvider(model);
  res.locals.provider = provider?.name || null;
  res.locals.model = model;

  logger.debug({ event: 'stream_start', provider: provider?.name, model, request_id: req.requestId });

  // Fail-fast checks (same as router.route())
  const { getProviderSetting } = require('../db');
  const { getCachedProviderStatus } = require('../health');
  const { providerUnavailable } = require('../errors');

  const setting = getProviderSetting(provider.name);
  if (setting && !setting.enabled) {
    logger.debug({ event: 'stream_blocked', reason: 'disabled', provider: provider.name });
    return sendOpenAIError(res, providerUnavailable(`${provider.name} is disabled`));
  }
  const healthStatus = getCachedProviderStatus(provider.name);
  if (healthStatus && healthStatus.authenticated === false) {
    logger.debug({ event: 'stream_blocked', reason: 'unauthenticated', provider: provider.name });
    return sendOpenAIError(res, providerUnavailable(`${provider.name} is not authenticated`));
  }

  const ac = new AbortController();
  initSSE(res);

  // Detect client disconnect: poll socket state instead of relying on close events
  // (Express close events fire prematurely after flushHeaders in some environments)
  const disconnectCheck = setInterval(() => {
    if (req.socket?.destroyed) {
      logger.debug({ event: 'stream_client_disconnect', request_id: req.requestId });
      ac.abort();
      clearInterval(disconnectCheck);
    }
  }, 1000);
  res.on('finish', () => clearInterval(disconnectCheck));

  const id = `shellm-${req.requestId}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;

  try {
    logger.debug({ event: 'stream_queue_wait', active: queue.stats.active, pending: queue.stats.pending, request_id: req.requestId });
    await queue.enqueue(async () => {
      logger.debug({ event: 'stream_queue_entered', request_id: req.requestId });
      // Determine if provider supports streaming
      const streamFn = provider.chatStream;

      if (streamFn) {
        logger.debug({ event: 'stream_calling_provider', provider: provider.name, hasChatStream: true });
        // Native streaming
        let chunkCount = 0;
        for await (const event of streamFn({ prompt, system, max_tokens, temperature, model, signal: ac.signal })) {
          if (ac.signal.aborted) { logger.debug({ event: 'stream_aborted', chunkCount }); break; }
          if (event.type === 'delta') {
            chunkCount++;
            if (chunkCount === 1) logger.debug({ event: 'stream_first_token', request_id: req.requestId });
            if (!sentRole) {
              sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: event.content }, finish_reason: null }] });
              sentRole = true;
            } else {
              sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }] });
            }
          }
        }
        logger.debug({ event: 'stream_generator_done', chunkCount, request_id: req.requestId });
      } else {
        logger.debug({ event: 'stream_fallback', provider: provider.name });
        // Buffer-and-flush fallback (e.g., Gemini)
        const result = await provider.chat({ prompt, system, max_tokens, temperature, model });
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: result.content }, finish_reason: null }] });
      }

      // Final chunk with finish_reason
      if (!ac.signal.aborted) {
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        sendSSEDone(res);
        logger.debug({ event: 'stream_complete', request_id: req.requestId });
      }
    });
  } catch (err) {
    logger.debug({ event: 'stream_error', error: err.message, request_id: req.requestId });
    if (!ac.signal.aborted && !res.writableEnded) {
      sendSSEError(res, err);
    }
  }
}

module.exports = { chatCompletionsHandler, extractMessages, validate };
