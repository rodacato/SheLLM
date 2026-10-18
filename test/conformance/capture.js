'use strict';

const INVALID_KEY = 'conformance-invalid-key';
const KEPT_HEADERS = ['content-type', 'request-id', 'x-request-id', 'retry-after', 'anthropic-version'];
const SECRETS = [/\borg-[A-Za-z0-9]{8,}/g, /\bproj_[A-Za-z0-9]{8,}/g, /\bsk-[A-Za-z0-9_-]{8,}/g];

function substitute(value, model) {
  return JSON.parse(JSON.stringify(value).replaceAll('$MODEL', model));
}

function buildRequest(target, api, kase) {
  const method = kase.method || 'POST';
  const headers = { 'content-type': 'application/json' };
  const key = kase.auth === 'invalid' ? INVALID_KEY : target.apiKey;
  if (api === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['x-api-key'] = key;
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  const body = kase.body === undefined ? undefined : substitute(kase.body, target.model);
  return {
    method,
    path: kase.path.replace('$MODEL', target.model),
    headers: { ...headers, ...kase.headers },
    body,
    payload: method === 'GET' ? undefined : kase.rawBody ?? JSON.stringify(body ?? {}),
  };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event;
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    const raw = data.join('\n');
    let parsed = raw;
    try { parsed = JSON.parse(raw); } catch { /* [DONE] and other plain markers stay strings */ }
    events.push(event ? { event, data: parsed } : { data: parsed });
  }
  return events;
}

function parseBody(text) {
  try { return JSON.parse(text); } catch { return text; }
}

function redact(recording, apiKey) {
  let text = JSON.stringify(recording);
  if (apiKey) text = text.replaceAll(apiKey, '[REDACTED]');
  for (const pattern of SECRETS) text = text.replace(pattern, '[REDACTED]');
  return JSON.parse(text);
}

async function send(target, api, kase) {
  const request = buildRequest(target, api, kase);
  const res = await fetch(target.baseUrl + request.path, {
    method: request.method,
    headers: request.headers,
    body: request.payload,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const headers = Object.fromEntries(KEPT_HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]));
  const response = { status: res.status, headers, header_names: [...res.headers.keys()].sort() };
  if (contentType.includes('text/event-stream')) response.events = parseSse(text);
  else response.body = parseBody(text);

  return redact({
    case: kase.id,
    target: target.name,
    model: target.model,
    request: { method: request.method, path: request.path, body: kase.rawBody ?? request.body },
    response,
  }, target.apiKey);
}

module.exports = { send, buildRequest, parseSse };
