const { route, resolveProvider, selectProvider, queue, acquireStreamSlot, releaseStreamSlot } = require('../../routing');
const { sanitize } = require('../../middleware/sanitize');
const { invalidRequest, fromCatchable, sendOpenAIError } = require('../../errors');
const { initSSE, announceQueued, sendSSEChunk, sendSSEDone, sendSSEError } = require('../../lib/sse');
const { shellmMeta } = require('../../lib/shellm-meta');

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

// Claude takes the schema as one argv string, and Linux caps a single argument at 128 KiB.
const MAX_SCHEMA_BYTES = 100 * 1024;
const SCHEMA_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateResponseFormat(format) {
  if (!isPlainObject(format) || !['json_object', 'json_schema', 'text'].includes(format.type)) {
    return invalidRequest('Field "response_format" must be an object with type "json_schema", "json_object" or "text"');
  }
  if (format.type !== 'json_schema') return null;

  const spec = format.json_schema;
  if (!isPlainObject(spec)) {
    return invalidRequest('Field "response_format.json_schema" must be an object with "name" and "schema"');
  }
  if (typeof spec.name !== 'string' || !SCHEMA_NAME.test(spec.name)) {
    return invalidRequest('Field "response_format.json_schema.name" must be 1-64 letters, digits, underscores or dashes');
  }
  if (!isPlainObject(spec.schema)) {
    return invalidRequest('Field "response_format.json_schema.schema" must be a JSON Schema object');
  }
  if (spec.strict !== undefined && spec.strict !== null && typeof spec.strict !== 'boolean') {
    return invalidRequest('Field "response_format.json_schema.strict" must be a boolean');
  }
  const size = Buffer.byteLength(JSON.stringify(spec.schema));
  if (size > MAX_SCHEMA_BYTES) {
    return invalidRequest(`Field "response_format.json_schema.schema" exceeds ${MAX_SCHEMA_BYTES} bytes (got ${size})`);
  }
  return null;
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
    const formatError = validateResponseFormat(body.response_format);
    if (formatError) return formatError;
  }

  if (body.stream_options !== undefined && body.stream_options !== null) {
    if (body.stream !== true) {
      return invalidRequest('Field "stream_options" can only be used when "stream" is true');
    }
    if (typeof body.stream_options !== 'object' || Array.isArray(body.stream_options)) {
      return invalidRequest('Field "stream_options" must be an object');
    }
    if (body.stream_options.include_usage !== undefined && typeof body.stream_options.include_usage !== 'boolean') {
      return invalidRequest('Field "stream_options.include_usage" must be a boolean');
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
    res.locals.metrics = result.metrics ?? null;

    res.set('X-Powered-By', 'SheLLM');
    res.set('X-Queue-Depth', String(queue.stats.pending));
    res.set('X-Queue-Active', String(queue.stats.active));
    res.set('x-shellm-queue-ms', String(result.queued_ms ?? 0));
    res.set('x-shellm-queue-position', String(result.queue_position ?? 0));
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
      x_shellm: shellmMeta({
        cost_usd: result.cost_usd ?? null,
        queue_ms: result.queued_ms ?? null,
        cli_ms: result.duration_ms != null ? result.duration_ms - (result.queued_ms ?? 0) : null,
      }),
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
  const logger = require('../../lib/logger');
  let provider;
  try {
    provider = selectProvider(model);
  } catch (err) {
    logger.debug({ event: 'stream_blocked', reason: err.message, model });
    return sendOpenAIError(res, err);
  }

  res.locals.provider = provider.name;
  res.locals.model = model;
  res.locals.streamed = 1;

  logger.debug({ event: 'stream_start', provider: provider.name, model, request_id: req.requestId });

  const streamStart = Date.now();
  let ttftMs = null;
  const ac = new AbortController();
  res.set('X-Powered-By', 'SheLLM');
  // Read before the headers go out: once they are flushed nothing else can be added, and the
  // queue cannot move between this line and enqueue below.
  res.set('x-shellm-queue-position', String(queue.nextPosition));
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
  const responseModel = model;
  let sentRole = false;
  let slotAcquired = false;
  let stopQueueNotices = null;
  let queuedMs = null;
  let cliStart = null;
  const includeUsage = req.body.stream_options?.include_usage === true;

  try {
    logger.debug({ event: 'stream_queue_wait', active: queue.stats.active, pending: queue.stats.pending, request_id: req.requestId });
    await queue.enqueue(async ({ queued_ms }) => {
      if (stopQueueNotices) stopQueueNotices();
      queuedMs = queued_ms;
      cliStart = Date.now();
      res.locals.queued_ms = queued_ms;
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
          if (event.type === 'usage') {
            res.locals.usage = event.usage ?? null;
            res.locals.cost_usd = event.cost_usd ?? null;
            res.locals.metrics = event.metrics ?? null;
          }
        }
        logger.debug({ event: 'stream_generator_done', chunkCount, request_id: req.requestId });
      } else {
        logger.debug({ event: 'stream_fallback', provider: provider.name });
        const result = await provider.chat({ prompt, system, max_tokens, temperature, top_p, response_format, model });
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        sendSSEChunk(res, { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { content: result.content }, finish_reason: null }] });
      }

      // Final chunk with finish_reason + TTFT metric
      if (!ac.signal.aborted) {
        const meta = shellmMeta({
          cost_usd: res.locals.cost_usd ?? null,
          queue_ms: queuedMs,
          cli_ms: cliStart == null ? null : Date.now() - cliStart,
          ttft_ms: ttftMs,
        });
        const finalChunk = { id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
        if (ttftMs != null) finalChunk.shellm = { ttft_ms: ttftMs };
        finalChunk.x_shellm = meta;
        sendSSEChunk(res, finalChunk);

        // The usage chunk carries no choices and comes last, as the OpenAI API sends it.
        if (includeUsage) {
          const usage = res.locals.usage;
          sendSSEChunk(res, {
            id,
            object: 'chat.completion.chunk',
            created,
            model: responseModel,
            choices: [],
            usage: {
              prompt_tokens: usage?.input_tokens ?? null,
              completion_tokens: usage?.output_tokens ?? null,
              total_tokens: usage ? (usage.input_tokens + usage.output_tokens) : null,
            },
            x_shellm: meta,
          });
        }

        sendSSEDone(res);
        logger.debug({ event: 'stream_complete', ttft_ms: ttftMs, request_id: req.requestId });
      }
    }, `${provider.name} · ${model}`, { onQueued: (position) => { stopQueueNotices = announceQueued(res, position); } });
  } catch (err) {
    logger.debug({ event: 'stream_error', error: err.message, request_id: req.requestId });
    if (!ac.signal.aborted && !res.writableEnded) {
      sendSSEError(res, err);
    }
  } finally {
    if (stopQueueNotices) stopQueueNotices();
    if (slotAcquired) releaseStreamSlot();
  }
}

module.exports = { chatCompletionsHandler, extractMessages, validate };
