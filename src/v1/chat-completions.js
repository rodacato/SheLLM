const { route, resolveProvider, resolveUpstreamModel, selectProvider, queue, acquireStreamSlot, releaseStreamSlot } = require('../routing');
const { sanitize, checkPromptSafety } = require('../middleware/sanitize');
const { invalidRequest, promptRejected, fromCatchable, sendOpenAIError } = require('../errors');
const { initSSE, sendSSEChunk, sendSSEDone, sendSSEError } = require('../lib/sse');

const MAX_PROMPT_LENGTH = 50000;

/**
 * Normalize message content to a plain string.
 * Accepts a string (returned as-is) or an array of content parts
 * (OpenAI format: [{ type: "text", text: "..." }]).
 * Returns null if the content is invalid.
 */
function normalizeContent(content) {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return null;

  const parts = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block || typeof block !== 'object') return null;
    if (block.type !== 'text') return null;
    if (typeof block.text !== 'string') return null;
    parts.push(block.text);
  }
  return parts.join('\n');
}

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
    if (!msg || typeof msg.role !== 'string') {
      return invalidRequest(`messages[${i}] must have a string "role" field`);
    }
    const normalized = normalizeContent(msg.content);
    if (normalized === null) {
      return invalidRequest(`messages[${i}].content must be a string or array of text objects`);
    }
    msg.content = normalized;
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

  if (body.top_p !== undefined) {
    if (typeof body.top_p !== 'number' || body.top_p < 0 || body.top_p > 1) {
      return invalidRequest('Field "top_p" must be a number between 0 and 1');
    }
  }

  if (body.response_format !== undefined) {
    if (!body.response_format || typeof body.response_format !== 'object' || !['json_object', 'text'].includes(body.response_format.type)) {
      return invalidRequest('Field "response_format" must be an object with type "json_object" or "text"');
    }
  }

  if (body.stop !== undefined && body.stop !== null) {
    if (typeof body.stop !== 'string' && !Array.isArray(body.stop)) {
      return invalidRequest('Field "stop" must be a string or array of strings');
    }
    if (Array.isArray(body.stop)) {
      if (body.stop.length > 4) {
        return invalidRequest('Field "stop" array must have at most 4 elements');
      }
      for (const s of body.stop) {
        if (typeof s !== 'string') {
          return invalidRequest('Field "stop" array elements must be strings');
        }
      }
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

  const { model, max_tokens, temperature, top_p, response_format } = req.body;

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

  // Prompt injection guard
  const safety = checkPromptSafety(prompt, system, { request_id: req.id, client: req.clientName, safetyLevel: req.safetyLevel });
  if (safety) {
    sendOpenAIError(res, promptRejected());
    return null;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    sendOpenAIError(res, invalidRequest(
      `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${prompt.length})`
    ));
    return null;
  }

  return { model, max_tokens, temperature, top_p, response_format, prompt, system };
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

  const { model, max_tokens, temperature, top_p, response_format, prompt, system } = params;
  const startTime = Date.now();
  res.locals.provider = null;
  res.locals.model = model;

  try {
    const allowFallback = req.headers['x-shellm-allow-fallback'] === 'true' || undefined;
    const result = await route({ model, prompt, system, max_tokens, temperature, top_p, response_format, request_id: req.requestId, allowFallback });
    res.locals.provider = result.provider;
    res.locals.queued_ms = result.queued_ms ?? null;
    res.locals.cost_usd = result.cost_usd ?? null;
    res.locals.usage = result.usage ?? null;

    res.set('X-Powered-By', 'SheLLM');
    res.set('X-Queue-Depth', String(queue.stats.pending));
    res.set('X-Queue-Active', String(queue.stats.active));
    if (result.original_provider) {
      res.set('X-SheLLM-Fallback-Provider', result.provider);
    }

    res.json({
      id: `chatcmpl-${req.requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.upstream_model || result.model,
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
async function handleStream(req, res, { model, max_tokens, temperature, top_p, response_format, prompt, system }) {
  const logger = require('../lib/logger');
  let provider;
  try {
    provider = selectProvider(model);
  } catch (err) {
    logger.debug({ event: 'stream_blocked', reason: err.message, model });
    return sendOpenAIError(res, err);
  }

  res.locals.provider = provider.name;
  res.locals.model = model;

  logger.debug({ event: 'stream_start', provider: provider.name, model, request_id: req.requestId });

  const streamStart = Date.now();
  let ttftMs = null;
  const ac = new AbortController();
  res.set('X-Powered-By', 'SheLLM');
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

  const id = `chatcmpl-${req.requestId}`;
  const created = Math.floor(Date.now() / 1000);
  const responseModel = resolveUpstreamModel(model);
  let sentRole = false;
  let slotAcquired = false;

  try {
    logger.debug({ event: 'stream_queue_wait', active: queue.stats.active, pending: queue.stats.pending, request_id: req.requestId });
    await queue.enqueue(async () => {
      logger.debug({ event: 'stream_queue_entered', request_id: req.requestId });

      // Stream concurrency check (inside queue to avoid holding slots while waiting)
      if (!acquireStreamSlot()) {
        sendSSEError(res, { message: 'Too many concurrent streams, try again later', code: 'rate_limited' });
        return;
      }
      slotAcquired = true;
      // Determine if provider supports streaming
      const streamFn = provider.chatStream;

      if (streamFn) {
        logger.debug({ event: 'stream_calling_provider', provider: provider.name, hasChatStream: true });
        // Native streaming
        let chunkCount = 0;
        for await (const event of streamFn({ prompt, system, max_tokens, temperature, top_p, response_format, model, signal: ac.signal })) {
          if (ac.signal.aborted) { logger.debug({ event: 'stream_aborted', chunkCount }); break; }
          if (event.type === 'delta') {
            chunkCount++;
            if (chunkCount === 1) {
              ttftMs = Date.now() - streamStart;
              logger.debug({ event: 'stream_first_token', ttft_ms: ttftMs, request_id: req.requestId });
            }
            if (!sentRole) {
              // Send role and content as separate chunks per OpenAI spec
              sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
              sentRole = true;
            }
            sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }] });
          }
        }
        logger.debug({ event: 'stream_generator_done', chunkCount, request_id: req.requestId });
      } else {
        logger.debug({ event: 'stream_fallback', provider: provider.name });
        // Buffer-and-flush fallback (e.g., Gemini)
        const result = await provider.chat({ prompt, system, max_tokens, temperature, top_p, response_format, model });
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { content: result.content }, finish_reason: null }] });
      }

      // Final chunk with finish_reason + TTFT metric
      if (!ac.signal.aborted) {
        const finalChunk = { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
        if (ttftMs != null) finalChunk.shellm = { ttft_ms: ttftMs };
        sendSSEChunk(res, finalChunk);
        sendSSEDone(res);
        logger.debug({ event: 'stream_complete', ttft_ms: ttftMs, request_id: req.requestId });
      }
    });
  } catch (err) {
    logger.debug({ event: 'stream_error', error: err.message, request_id: req.requestId });
    if (!ac.signal.aborted && !res.writableEnded) {
      sendSSEError(res, err);
    }
  } finally {
    if (slotAcquired) releaseStreamSlot();
  }
}

module.exports = { chatCompletionsHandler, extractMessages, validate };
