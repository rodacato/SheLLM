const { route, resolveProvider, resolveUpstreamModel, selectProvider, queue, acquireStreamSlot, releaseStreamSlot } = require('../router');
const { sanitize, checkPromptSafety } = require('../middleware/sanitize');
const { invalidRequest, promptRejected, fromCatchable, sendAnthropicError } = require('../errors');
const { initSSE } = require('../lib/sse');
const {
  sendMessageStart, sendContentBlockStart, sendContentBlockDelta,
  sendContentBlockStop, sendMessageDelta, sendMessageStop, sendStreamError,
} = require('../lib/sse-anthropic');

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
  const { model, messages, max_tokens } = body;

  if (!model) {
    return invalidRequest('Missing required field: model');
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

  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 1) {
      return invalidRequest('Field "temperature" must be a number between 0 and 1');
    }
  }

  if (body.top_p !== undefined) {
    if (typeof body.top_p !== 'number' || body.top_p < 0 || body.top_p > 1) {
      return invalidRequest('Field "top_p" must be a number between 0 and 1');
    }
  }

  if (body.stop_sequences !== undefined) {
    if (!Array.isArray(body.stop_sequences)) {
      return invalidRequest('Field "stop_sequences" must be an array of strings');
    }
    for (const s of body.stop_sequences) {
      if (typeof s !== 'string') {
        return invalidRequest('Field "stop_sequences" elements must be strings');
      }
    }
  }

  return null;
}

/**
 * POST /v1/messages handler (Anthropic Messages API format)
 */
/**
 * Common pre-flight for /v1/messages: validate, enforce model restrictions,
 * extract and sanitize content.
 * Returns params object or sends error and returns null.
 */
function preflight(req, res) {
  const err = validate(req.body);
  if (err) { sendAnthropicError(res, err); return null; }

  const { model, max_tokens, temperature, top_p } = req.body;

  if (req.allowedModels && req.allowedModels.length > 0) {
    const providerObj = resolveProvider(model);
    const providerName = providerObj ? providerObj.name : null;
    if (!req.allowedModels.includes(model) && (!providerName || !req.allowedModels.includes(providerName))) {
      sendAnthropicError(res, invalidRequest(
        `Model "${model}" is not allowed for this API key. Allowed: ${req.allowedModels.join(', ')}`
      ));
      return null;
    }
  }

  // Normalize system prompt (string or array of text blocks)
  let systemParam = req.body.system || null;
  if (Array.isArray(systemParam)) {
    const parts = [];
    for (let i = 0; i < systemParam.length; i++) {
      const block = systemParam[i];
      if (!block || block.type !== 'text' || typeof block.text !== 'string') {
        sendAnthropicError(res, invalidRequest(
          `system[${i}] must be a text block with "type": "text" and string "text" field`
        ));
        return null;
      }
      parts.push(block.text);
    }
    systemParam = parts.join('\n');
  } else if (systemParam !== null && typeof systemParam !== 'string') {
    sendAnthropicError(res, invalidRequest('Field "system" must be a string or array of text blocks'));
    return null;
  }

  const extracted = extractPrompt(req.body.messages, systemParam);
  if (extracted.error) {
    sendAnthropicError(res, invalidRequest(extracted.error));
    return null;
  }

  let { prompt, system } = extracted;
  prompt = sanitize(prompt);
  if (system) system = sanitize(system);

  // Prompt injection guard
  const safety = checkPromptSafety(prompt, system, { request_id: req.id, client: req.clientName, safetyLevel: req.safetyLevel });
  if (safety) {
    sendAnthropicError(res, promptRejected());
    return null;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    sendAnthropicError(res, invalidRequest(
      `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${prompt.length})`
    ));
    return null;
  }

  return { model, max_tokens, temperature, top_p, prompt, system };
}

async function messagesHandler(req, res) {
  const params = preflight(req, res);
  if (!params) return;

  if (req.body.stream === true) {
    return handleAnthropicStream(req, res, params);
  }

  const { model, max_tokens, temperature, top_p, prompt, system } = params;
  const startTime = Date.now();
  res.locals.provider = null;
  res.locals.model = model;

  try {
    const allowFallback = req.headers['x-shellm-allow-fallback'] === 'true' || undefined;
    const result = await route({ model, prompt, system, max_tokens, temperature, top_p, request_id: req.requestId, allowFallback });
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
      id: `msg_${req.requestId}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: result.content }],
      model: result.upstream_model || result.model,
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

/**
 * Handle streaming response for /v1/messages (Anthropic SSE format).
 */
async function handleAnthropicStream(req, res, { model, max_tokens, temperature, top_p, prompt, system }) {
  const logger = require('../lib/logger');
  const { recordSuccess, recordFailure } = require('../circuit-breaker');

  let provider;
  try {
    provider = selectProvider(model);
  } catch (err) {
    logger.debug({ event: 'stream_blocked', reason: err.message, model });
    return sendAnthropicError(res, err);
  }

  res.locals.provider = provider.name;
  res.locals.model = model;

  logger.debug({ event: 'stream_start', format: 'anthropic', provider: provider.name, model, request_id: req.requestId });

  const streamStart = Date.now();
  let ttftMs = null;
  const ac = new AbortController();
  res.set('X-Powered-By', 'SheLLM');
  initSSE(res);

  // Client disconnect detection
  const disconnectCheck = setInterval(() => {
    if (req.socket?.destroyed) {
      logger.debug({ event: 'stream_client_disconnect', request_id: req.requestId });
      ac.abort();
      clearInterval(disconnectCheck);
    }
  }, 1000);
  res.on('finish', () => clearInterval(disconnectCheck));

  const id = `msg_${req.requestId}`;
  const responseModel = resolveUpstreamModel(model);
  let slotAcquired = false;

  try {
    await queue.enqueue(async () => {
      // Stream concurrency check (inside queue to avoid holding slots while waiting)
      if (!acquireStreamSlot()) {
        sendStreamError(res, new Error('Too many concurrent streams, try again later'));
        return;
      }
      slotAcquired = true;
      // Estimate input tokens from prompt length (real count unavailable during streaming)
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      sendMessageStart(res, id, responseModel, estimatedInputTokens);
      sendContentBlockStart(res, 0);

      const streamFn = provider.chatStream;
      let chunkCount = 0;
      let totalChars = 0;

      if (streamFn) {
        logger.debug({ event: 'stream_calling_provider', format: 'anthropic', provider: provider.name, hasChatStream: true });
        for await (const event of streamFn({ prompt, system, max_tokens, temperature, top_p, model, signal: ac.signal })) {
          if (ac.signal.aborted) { logger.debug({ event: 'stream_aborted', chunkCount }); break; }
          if (event.type === 'delta') {
            chunkCount++;
            totalChars += event.content.length;
            if (chunkCount === 1) {
              ttftMs = Date.now() - streamStart;
              logger.debug({ event: 'stream_first_token', ttft_ms: ttftMs, request_id: req.requestId });
            }
            sendContentBlockDelta(res, 0, event.content);
          }
        }
        recordSuccess(provider.name);
      } else {
        logger.debug({ event: 'stream_fallback', format: 'anthropic', provider: provider.name });
        const result = await provider.chat({ prompt, system, max_tokens, temperature, top_p, model });
        totalChars += result.content.length;
        sendContentBlockDelta(res, 0, result.content);
        recordSuccess(provider.name);
      }

      if (!ac.signal.aborted) {
        const estimatedOutputTokens = Math.ceil(totalChars / 4);
        sendContentBlockStop(res, 0);
        sendMessageDelta(res, 'end_turn', estimatedOutputTokens, ttftMs);
        sendMessageStop(res);
        logger.debug({ event: 'stream_complete', format: 'anthropic', ttft_ms: ttftMs, request_id: req.requestId });
      }
    });
  } catch (err) {
    recordFailure(provider.name);
    logger.debug({ event: 'stream_error', format: 'anthropic', error: err.message, request_id: req.requestId });
    if (!ac.signal.aborted && !res.writableEnded) {
      sendStreamError(res, err);
    }
  } finally {
    if (slotAcquired) releaseStreamSlot();
  }
}

module.exports = { messagesHandler, extractContent, extractPrompt, validate };
