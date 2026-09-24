#!/usr/bin/env node

'use strict';

// node scripts/bench.js --suite capabilities|latency|all [--out run.json]
// Reads SHELLM_BASE and SHELLM_KEY from the environment; --base and --key override them.
// Every request is real: a run spends subscription quota.

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function has(name) {
  return args.includes(`--${name}`);
}

const BASE = flag('base', process.env.SHELLM_BASE || 'http://127.0.0.1:6100').replace(/\/$/, '');
const KEY = flag('key', process.env.SHELLM_KEY || '');
const SUITE = flag('suite', 'all');
const ITERATIONS = parseInt(flag('iterations', '3'), 10);
const CONCURRENCY = parseInt(flag('concurrency', '6'), 10);
const TIMEOUT_MS = parseInt(flag('timeout', '180000'), 10);
const OUT = flag('out', '');
const ONLY = flag('only', '').split(',').filter(Boolean);
const MODELS = flag('models', 'claude,claude-haiku,claude-sonnet,claude-opus').split(',');

if (!KEY) {
  console.error('No API key. Pass --key or set SHELLM_KEY.');
  process.exit(2);
}

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const records = [];
const probes = [];
let rateLimited = 0;

// Prompt sizes use the 4-chars-per-token rule of thumb, not a tokenizer.
const FILLER =
  'The deployment notes say the service runs behind a tunnel, keeps its state in SQLite, ' +
  'and spawns one process per request so nothing leaks between callers. ';

function promptOfTokens(tokens) {
  const target = tokens * 4;
  let text = '';
  while (text.length < target) text += FILLER;
  return text.slice(0, target);
}

const PROMPTS = {
  tiny: 'Reply with exactly one word: pong',
  medium: `${promptOfTokens(500)}\n\nReply with exactly one word: pong`,
  large: `${promptOfTokens(4000)}\n\nReply with exactly one word: pong`,
};

const OUTPUTS = {
  word: 'Reply with exactly one word: pong',
  paragraph: 'Write exactly 100 words about the sea. No preamble, no title.',
  page: 'Write exactly 500 words about the sea. No preamble, no title.',
};

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function post(path, body, { headers, timeoutMs = TIMEOUT_MS, raw } = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: headers || authHeaders(),
      body: raw !== undefined ? raw : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not every response is JSON */ }
    return { ok: res.ok, status: res.status, headers: res.headers, text, json, ms: performance.now() - started };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, text: '', json: null, ms: performance.now() - started };
  }
}

async function get(path, { headers } = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: headers || authHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not every response is JSON */ }
    return { ok: res.ok, status: res.status, text, json, ms: performance.now() - started };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, text: '', json: null, ms: performance.now() - started };
  }
}

const FIRST_CONTENT = {
  '/v1/chat/completions': /"delta":\s*{[^}]*"content":\s*"[^"]/,
  '/v1/messages': /"type":\s*"content_block_delta"/,
};

async function postStream(path, body) {
  const started = performance.now();
  const isContent = FIRST_CONTENT[path];
  let ttfb = null;
  let ttft = null;
  let chunks = 0;
  let payload = '';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      return { ok: false, status: res.status, text, ttfb: null, ttft: null, chunks: 0, ms: performance.now() - started };
    }
    const decoder = new TextDecoder();
    for await (const part of res.body) {
      const piece = decoder.decode(part, { stream: true });
      if (piece.trim().length === 0) continue;
      if (ttfb === null) ttfb = performance.now() - started;
      if (ttft === null && isContent?.test(piece)) ttft = performance.now() - started;
      chunks++;
      payload += piece;
    }
    return { ok: true, status: res.status, text: payload, ttfb, ttft, chunks, ms: performance.now() - started };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, text: payload, ttfb, ttft, chunks, ms: performance.now() - started };
  }
}

function openaiBody(model, content, extra = {}) {
  return { model, messages: [{ role: 'user', content }], ...extra };
}

function anthropicBody(model, content, extra = {}) {
  return { model, max_tokens: 1024, messages: [{ role: 'user', content }], ...extra };
}

function openaiText(json) {
  return json?.choices?.[0]?.message?.content ?? '';
}

function anthropicText(json) {
  const blocks = json?.content || [];
  return blocks.map((b) => b.text || '').join('');
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms);
  return {
    n: samples.length,
    failed: samples.filter((s) => !s.ok).length,
    min: ok.length ? Math.round(Math.min(...ok)) : null,
    median: ok.length ? Math.round(percentile(ok, 50)) : null,
    max: ok.length ? Math.round(Math.max(...ok)) : null,
  };
}

function wanted(scenario) {
  return ONLY.length === 0 || ONLY.includes(scenario);
}

function record(scenario, label, samples, extra = {}) {
  rateLimited += samples.filter((s) => s.status === 429).length;
  const row = { scenario, label, ...summarize(samples), ...extra };
  records.push(row);
  const failed = row.failed ? `${RED} ${row.failed} failed${RESET}` : '';
  const median = row.median === null ? '—' : `${(row.median / 1000).toFixed(2)}s`;
  const range = row.min === null ? '' : `${DIM}(${(row.min / 1000).toFixed(2)}–${(row.max / 1000).toFixed(2)}s)${RESET}`;
  console.log(`  ${label.padEnd(34)} ${median.padStart(8)}  ${range}${failed}`);
  return row;
}

async function repeat(n, fn) {
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(await fn(i));
  return samples;
}

function probe(id, question, verdict, detail, evidence = {}) {
  const row = { id, question, verdict, detail, ...evidence };
  probes.push(row);
  const color = verdict === 'works' ? GREEN : verdict === 'rejected' ? YELLOW : verdict === 'broken' ? RED : DIM;
  console.log(`  ${color}${verdict.padEnd(10)}${RESET} ${question.padEnd(44)} ${DIM}${detail}${RESET}`);
  return row;
}

async function capabilitySuite(model) {
  console.log(`\n${BOLD}Capabilities${RESET} ${DIM}(model: ${model})${RESET}`);

  const models = await get('/v1/models');
  probe(
    'models',
    'GET /v1/models lists the usable models',
    models.ok ? 'works' : 'broken',
    models.ok ? (models.json?.data || []).map((m) => m.id).join(', ') : `HTTP ${models.status}`,
    { status: models.status },
  );

  const multi = await post('/v1/chat/completions', {
    model,
    messages: [
      { role: 'user', content: 'My favourite colour is turquoise. Remember it.' },
      { role: 'assistant', content: 'Noted: turquoise.' },
      { role: 'user', content: 'What is my favourite colour? Answer with one word.' },
    ],
  });
  const multiText = openaiText(multi.json).toLowerCase();
  probe(
    'multi-turn',
    'Multi-turn history is carried into the prompt',
    multi.ok && multiText.includes('turquoise') ? 'works' : multi.ok ? 'broken' : 'broken',
    multi.ok ? `answered "${openaiText(multi.json).trim().slice(0, 40)}"` : `HTTP ${multi.status}`,
    { status: multi.status, ms: Math.round(multi.ms) },
  );

  const system = await post('/v1/messages', {
    model,
    max_tokens: 256,
    system: 'You always answer in exactly one word, in French.',
    messages: [{ role: 'user', content: 'What colour is the sky on a clear day?' }],
  });
  const systemText = anthropicText(system.json).trim();
  probe(
    'system',
    'A top-level system prompt steers the answer',
    system.ok && /bleu/i.test(systemText) ? 'works' : system.ok ? 'partial' : 'broken',
    system.ok ? `answered "${systemText.slice(0, 40)}"` : `HTTP ${system.status}`,
    { status: system.status, ms: Math.round(system.ms) },
  );

  const json = await post('/v1/chat/completions', openaiBody(
    model,
    'Return a JSON object with keys "city" and "country" for Colima, Mexico. JSON only.',
    { response_format: { type: 'json_object' } },
  ));
  let parsed = null;
  try {
    parsed = JSON.parse(openaiText(json.json).trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch { /* the point of the probe */ }
  probe(
    'json-mode',
    'response_format json_object returns parseable JSON',
    json.ok && parsed ? 'works' : json.ok ? 'partial' : 'broken',
    json.ok ? (parsed ? `parsed keys: ${Object.keys(parsed).join(', ')}` : 'returned prose, not JSON') : `HTTP ${json.status}`,
    { status: json.status, ms: Math.round(json.ms) },
  );

  const schemaReply = await post('/v1/chat/completions', openaiBody(
    model,
    'Give the city and country for Colima, Mexico.',
    {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'place',
          strict: true,
          schema: {
            type: 'object',
            properties: { city: { type: 'string' }, country: { type: 'string' } },
            required: ['city', 'country'],
            additionalProperties: false,
          },
        },
      },
    },
  ));
  let place = null;
  try {
    place = JSON.parse(openaiText(schemaReply.json));
  } catch { /* the point of the probe */ }
  const conforms = place && typeof place.city === 'string' && typeof place.country === 'string'
    && Object.keys(place).length === 2;
  probe(
    'json-schema',
    'response_format json_schema returns conforming JSON',
    schemaReply.ok && conforms ? 'works' : schemaReply.ok ? 'partial' : 'broken',
    schemaReply.ok ? (conforms ? `city=${place.city}, country=${place.country}` : 'did not match the schema') : `HTTP ${schemaReply.status}`,
    { status: schemaReply.status, ms: Math.round(schemaReply.ms) },
  );

  const sseOpenai = await postStream('/v1/chat/completions', openaiBody(model, OUTPUTS.paragraph, { stream: true }));
  probe(
    'stream-openai',
    'Streaming on /v1/chat/completions (SSE)',
    sseOpenai.ok && sseOpenai.text.includes('data:') ? 'works' : 'broken',
    sseOpenai.ok
      ? `${sseOpenai.chunks} chunks, first text at ${(sseOpenai.ttft / 1000).toFixed(2)}s, done in ${(sseOpenai.ms / 1000).toFixed(2)}s`
      : `HTTP ${sseOpenai.status}`,
    { status: sseOpenai.status, ttfb: Math.round(sseOpenai.ttfb || 0), ttft: Math.round(sseOpenai.ttft || 0), chunks: sseOpenai.chunks },
  );

  const sseAnthropic = await postStream('/v1/messages', anthropicBody(model, OUTPUTS.paragraph, { stream: true }));
  probe(
    'stream-anthropic',
    'Streaming on /v1/messages (named SSE events)',
    sseAnthropic.ok && sseAnthropic.text.includes('event: content_block_delta') ? 'works' : 'broken',
    sseAnthropic.ok
      ? `${sseAnthropic.chunks} chunks, first text at ${(sseAnthropic.ttft / 1000).toFixed(2)}s, done in ${(sseAnthropic.ms / 1000).toFixed(2)}s`
      : `HTTP ${sseAnthropic.status}`,
    { status: sseAnthropic.status, ttfb: Math.round(sseAnthropic.ttfb || 0), ttft: Math.round(sseAnthropic.ttft || 0), chunks: sseAnthropic.chunks },
  );

  const long = await post('/v1/chat/completions', openaiBody(model, PROMPTS.large));
  probe(
    'long-context',
    'A ~4k-token prompt is accepted',
    long.ok ? 'works' : 'broken',
    long.ok ? `answered in ${(long.ms / 1000).toFixed(2)}s` : `HTTP ${long.status} ${long.json?.error?.message || long.error || ''}`,
    { status: long.status, ms: Math.round(long.ms) },
  );

  const capped = await post('/v1/chat/completions', openaiBody(model, OUTPUTS.page, { max_tokens: 16 }));
  const cappedChars = openaiText(capped.json).length;
  probe(
    'max-tokens',
    'max_tokens truncates the answer',
    capped.ok && cappedChars < 200 ? 'works' : capped.ok ? 'ignored' : 'broken',
    capped.ok ? `asked for 500 words with max_tokens=16, got ${cappedChars} chars` : `HTTP ${capped.status}`,
    { status: capped.status, chars: cappedChars },
  );

  const extras = await post('/v1/chat/completions', openaiBody(model, PROMPTS.tiny, {
    temperature: 0.7,
    top_p: 0.9,
    stop: ['\n\n'],
    seed: 42,
    n: 1,
    user: 'bench',
    frequency_penalty: 0.1,
  }));
  probe(
    'sdk-extras',
    'SDK fields an app sends anyway are accepted',
    extras.ok ? 'works' : 'broken',
    extras.ok ? 'temperature, top_p, stop, seed, n, user accepted (no effect on the CLI)' : `HTTP ${extras.status}`,
    { status: extras.status },
  );

  const tools = await post('/v1/chat/completions', openaiBody(model, 'What is the weather in Colima? Use the tool.', {
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
    }],
  }));
  const calledTool = Boolean(tools.json?.choices?.[0]?.message?.tool_calls);
  probe(
    'tools',
    'Function calling / tool use',
    tools.ok && calledTool ? 'works' : tools.ok ? 'ignored' : 'rejected',
    tools.ok ? (calledTool ? 'returned tool_calls' : 'accepted the tools field and answered in prose') : `HTTP ${tools.status}`,
    { status: tools.status },
  );

  const image = await post('/v1/chat/completions', {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
      ],
    }],
  });
  probe(
    'images',
    'Image content blocks',
    image.status >= 400 && image.status < 500 ? 'rejected' : image.ok ? 'works' : 'broken',
    `HTTP ${image.status} ${image.json?.error?.code || image.json?.error?.type || ''}`,
    { status: image.status },
  );

  const unknown = await post('/v1/chat/completions', openaiBody('gpt-4o', PROMPTS.tiny));
  probe(
    'unknown-model',
    'A model name no provider owns',
    unknown.status === 400 ? 'rejected' : unknown.ok ? 'works' : 'broken',
    `HTTP ${unknown.status} ${unknown.json?.error?.code || unknown.json?.error?.type || ''}`,
    { status: unknown.status },
  );

  const unknownClaude = await post('/v1/chat/completions', openaiBody('claude-does-not-exist', PROMPTS.tiny));
  probe(
    'unknown-claude-model',
    'A claude-* name the CLI does not know',
    unknownClaude.status === 404 ? 'rejected' : unknownClaude.ok ? 'works' : 'broken',
    `HTTP ${unknownClaude.status} ${unknownClaude.json?.error?.code || unknownClaude.json?.error?.type || ''}`,
    { status: unknownClaude.status },
  );

  const noAuth = await post('/v1/chat/completions', openaiBody(model, PROMPTS.tiny), {
    headers: { 'Content-Type': 'application/json' },
  });
  probe(
    'auth',
    'A request without a key',
    noAuth.status === 401 ? 'rejected' : 'broken',
    `HTTP ${noAuth.status} ${noAuth.json?.error?.code || noAuth.json?.error?.type || noAuth.text.slice(0, 40)}`,
    { status: noAuth.status },
  );

  const badOpenai = await post('/v1/chat/completions', { messages: [] });
  const badAnthropic = await post('/v1/messages', { max_tokens: 16, messages: [] });
  const openaiShaped = typeof badOpenai.json?.error === 'object' && Boolean(badOpenai.json?.error?.type);
  const anthropicShaped = badAnthropic.json?.type === 'error' && Boolean(badAnthropic.json?.error?.type);
  probe(
    'error-format-4xx',
    'A validation error keeps the endpoint\'s own error shape',
    openaiShaped && anthropicShaped ? 'works' : 'broken',
    `openai-shaped=${openaiShaped} anthropic-shaped=${anthropicShaped}`,
    { status: badOpenai.status },
  );

  const noAuthOpenai = await post('/v1/chat/completions', openaiBody(model, PROMPTS.tiny), {
    headers: { 'Content-Type': 'application/json' },
  });
  const noAuthAnthropic = await post('/v1/messages', anthropicBody(model, PROMPTS.tiny), {
    headers: { 'Content-Type': 'application/json' },
  });
  const authOpenaiShaped = typeof noAuthOpenai.json?.error === 'object';
  const authAnthropicShaped = noAuthAnthropic.json?.type === 'error';
  probe(
    'error-format-401',
    'A 401 keeps the endpoint\'s own error shape',
    authOpenaiShaped && authAnthropicShaped ? 'works' : 'broken',
    `openai-shaped=${authOpenaiShaped} anthropic-shaped=${authAnthropicShaped}, both return ${JSON.stringify(noAuthOpenai.json).slice(0, 60)}`,
    { status: noAuthOpenai.status },
  );

  const oversized = await post('/v1/chat/completions', null, {
    raw: JSON.stringify(openaiBody(model, promptOfTokens(80000))),
  });
  probe(
    'payload-limit',
    'A payload over the 256 kB body limit',
    oversized.status >= 400 ? 'rejected' : 'works',
    `HTTP ${oversized.status}`,
    { status: oversized.status },
  );

  const embeddings = await post('/v1/embeddings', { model, input: 'hello' });
  probe(
    'embeddings',
    'POST /v1/embeddings',
    embeddings.status === 404 ? 'rejected' : embeddings.ok ? 'works' : 'broken',
    `HTTP ${embeddings.status}`,
    { status: embeddings.status },
  );
}

const LATENCY_SCENARIOS = {
  overhead: async () => {
    console.log(`\n${BOLD}Overhead floor${RESET} ${DIM}(no CLI, no quota)${RESET}`);
    record('overhead', 'GET /health', await repeat(5, () => get('/health', { headers: {} })));
    record('overhead', 'GET /v1/models', await repeat(5, () => get('/v1/models')));
  },

  model: async () => {
    console.log(`\n${BOLD}Model sweep${RESET} ${DIM}(tiny prompt, one-word answer, n=${ITERATIONS})${RESET}`);
    for (const m of MODELS) {
      const samples = await repeat(ITERATIONS, () => post('/v1/chat/completions', openaiBody(m, PROMPTS.tiny)));
      record('model', m, samples, { model: m });
    }
  },

  'prompt-length': async (model) => {
    console.log(`\n${BOLD}Prompt length${RESET} ${DIM}(${model}, one-word answer, n=${ITERATIONS})${RESET}`);
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      const samples = await repeat(ITERATIONS, () => post('/v1/chat/completions', openaiBody(model, prompt)));
      record('prompt-length', `${name} (~${Math.round(prompt.length / 4)} tok in)`, samples, { model, chars_in: prompt.length });
    }
  },

  'output-length': async (model) => {
    console.log(`\n${BOLD}Output length${RESET} ${DIM}(${model}, tiny prompt, n=${ITERATIONS})${RESET}`);
    for (const [name, instruction] of Object.entries(OUTPUTS)) {
      const samples = await repeat(ITERATIONS, () => post('/v1/chat/completions', openaiBody(model, instruction)));
      const chars = samples.map((s) => openaiText(s.json).length).filter(Boolean);
      const avgChars = chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : 0;
      record('output-length', `${name} (~${avgChars} chars out)`, samples, { model, chars_out: avgChars });
    }
  },

  streaming: async (model) => {
    console.log(`\n${BOLD}Streaming${RESET} ${DIM}(100-word answer, time to first text, n=${ITERATIONS})${RESET}`);
    for (const m of ['claude-haiku', 'claude-sonnet']) {
      const samples = await repeat(ITERATIONS, () => postStream('/v1/chat/completions', openaiBody(m, OUTPUTS.paragraph, { stream: true })));
      recordStream('/v1/chat/completions', `${m} (stream)`, samples, m);
    }
    const anthropic = await repeat(ITERATIONS, () => postStream('/v1/messages', anthropicBody(model, OUTPUTS.paragraph, { stream: true })));
    recordStream('/v1/messages', `${model} (stream, /v1/messages)`, anthropic, model);
  },

  endpoint: async (model) => {
    console.log(`\n${BOLD}Endpoint parity${RESET} ${DIM}(${model}, tiny prompt, n=${ITERATIONS})${RESET}`);
    record('endpoint', 'POST /v1/chat/completions', await repeat(ITERATIONS, () => post('/v1/chat/completions', openaiBody(model, PROMPTS.tiny))), { model });
    record('endpoint', 'POST /v1/messages', await repeat(ITERATIONS, () => post('/v1/messages', anthropicBody(model, PROMPTS.tiny))), { model });
  },

  concurrency: async () => {
    console.log(`\n${BOLD}Concurrency${RESET} ${DIM}(${CONCURRENCY} at once against MAX_CONCURRENT)${RESET}`);
    const wallStart = performance.now();
    const burst = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => post('/v1/chat/completions', openaiBody('claude-haiku', PROMPTS.tiny))),
    );
    const wall = performance.now() - wallStart;
    const row = record('concurrency', `${CONCURRENCY} parallel (claude-haiku)`, burst, { model: 'claude-haiku', wall_ms: Math.round(wall) });
    row.statuses = burst.map((b) => b.status);
    console.log(`  ${DIM}↳ wall clock ${(wall / 1000).toFixed(2)}s, statuses ${row.statuses.join(' ')}${RESET}`);
  },
};

function recordStream(path, label, samples, model) {
  const medianOf = (key) => {
    const values = samples.filter((s) => s.ok && s[key] !== null).map((s) => s[key]);
    return values.length ? Math.round(percentile(values, 50)) : null;
  };
  const ttfb = medianOf('ttfb');
  const ttft = medianOf('ttft');
  record('streaming', label, samples, { model, endpoint: path, ttfb_median: ttfb, ttft_median: ttft });
  if (ttft !== null) {
    console.log(`  ${DIM}↳ first event after ${(ttfb / 1000).toFixed(2)}s, first text after ${(ttft / 1000).toFixed(2)}s${RESET}`);
  }
}

async function latencySuite(model) {
  for (const [name, scenario] of Object.entries(LATENCY_SCENARIOS)) {
    if (!wanted(name)) continue;
    await scenario(model);
  }
}

async function main() {
  const model = flag('model', 'claude-sonnet');
  const started = new Date().toISOString();
  console.log(`${BOLD}SheLLM benchmark${RESET} ${DIM}${BASE} · node ${process.version} · ${started}${RESET}`);

  if (SUITE === 'capabilities' || SUITE === 'all') await capabilitySuite(model);
  if (SUITE === 'latency' || SUITE === 'all') await latencySuite(model);

  const report = {
    meta: {
      base: BASE,
      started,
      finished: new Date().toISOString(),
      node: process.version,
      suite: SUITE,
      iterations: ITERATIONS,
      reference_model: model,
    },
    probes,
    records,
  };

  if (OUT) {
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n${DIM}Wrote ${OUT}${RESET}`);
  }
  if (has('json')) console.log(JSON.stringify(report, null, 2));

  const broken = probes.filter((p) => p.verdict === 'broken').length;
  const failed = records.reduce((n, r) => n + r.failed, 0);
  if (rateLimited > 0) {
    console.log(`\n${YELLOW}${rateLimited} requests were rate limited (429).${RESET} The rows above are incomplete: a`
      + ' benchmark outruns the default 60 req/min. Raise SHELLM_GLOBAL_RPM on the server, or run one'
      + ' --only scenario at a time.');
  }
  console.log(`\n${BOLD}BENCH_RUN_COMPLETE${RESET} ${DIM}probes=${probes.length} broken=${broken} rows=${records.length} failed_requests=${failed} rate_limited=${rateLimited}${RESET}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
