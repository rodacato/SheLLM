'use strict';

// Paths whose value is part of the contract, not just their type.
const VALUE_PATHS = {
  anthropic: ['type', 'role', 'stop_reason', 'error.type', 'content[].type', 'content_block.type', 'delta.type', 'delta.stop_reason', 'message.type', 'message.role'],
  openai: ['object', 'error.type', 'error.code', 'error.param', 'choices[].finish_reason', 'choices[].message.role', 'choices[].delta.role'],
};

const NOTABLE_HEADERS = {
  anthropic: ['content-type', 'request-id', 'retry-after'],
  openai: ['content-type', 'x-request-id', 'retry-after'],
};

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function flatten(value, valuePaths, prefix = '', relative = '', out = { types: new Map(), values: new Map() }) {
  if (prefix) {
    if (!out.types.has(prefix)) out.types.set(prefix, new Set());
    out.types.get(prefix).add(typeOf(value));
    if (valuePaths.includes(relative) && typeOf(value) !== 'object' && typeOf(value) !== 'array') {
      if (!out.values.has(prefix)) out.values.set(prefix, new Set());
      out.values.get(prefix).add(value);
    }
  }
  const join = (base, key) => (base ? `${base}.${key}` : key);
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, valuePaths, `${prefix}[]`, `${relative}[]`, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, valuePaths, join(prefix, key), join(relative, key), out);
  }
  return out;
}

function eventLabel(api, entry) {
  if (api === 'anthropic') return entry.event || 'data';
  const data = entry.data;
  if (typeof data === 'string') return data;
  if (data.error) return 'error';
  if (Array.isArray(data.choices) && data.choices.length === 0) return 'usage';
  const choice = data.choices?.[0] || {};
  if (choice.finish_reason) return 'finish';
  if (choice.delta?.role) return 'role';
  return 'delta';
}

function collapse(labels) {
  return labels.filter((label, i) => label !== labels[i - 1]);
}

// Streams are compared per event kind: each event's data is flattened under its label, so
// message_delta.usage and message_start.message.usage are told apart.
function profile(api, response) {
  const valuePaths = VALUE_PATHS[api];
  const result = { status: response.status, headers: response.header_names || [], types: new Map(), values: new Map(), sequence: null };
  if (response.events) {
    const labels = response.events.map((e) => eventLabel(api, e));
    result.sequence = collapse(labels);
    response.events.forEach((entry, i) => {
      if (typeof entry.data === 'string') return;
      const prefix = api === 'anthropic' ? labels[i] : 'chunk';
      flatten(entry.data, valuePaths, prefix, '', result);
    });
  } else if (response.body !== undefined && typeof response.body === 'object') {
    flatten(response.body, valuePaths, '', '', result);
  } else {
    result.types.set('(body)', new Set([typeOf(response.body)]));
  }
  return result;
}

function topmost(paths) {
  const sorted = [...paths].sort();
  return sorted.filter((p) => !sorted.some((q) => q !== p && (p.startsWith(`${q}.`) || p.startsWith(`${q}[]`))));
}

function setsEqual(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

const show = (set) => [...set].map((v) => JSON.stringify(v)).join(' | ');

function describeStatus(response) {
  const error = response.body?.error;
  return error ? `${response.status} ${error.type || error.code}: ${error.message}` : response.status;
}

function diff(api, reference, actual) {
  const ref = profile(api, reference);
  const act = profile(api, actual);
  const diffs = [];

  if (ref.status !== act.status) {
    diffs.push({ kind: 'status', path: '(status)', reference: describeStatus(reference), actual: describeStatus(actual) });
    // A success judged against an error has no shape worth comparing.
    if (Math.floor(ref.status / 100) !== Math.floor(act.status / 100)) return diffs;
  }
  if (ref.sequence || act.sequence) {
    const r = (ref.sequence || ['(not a stream)']).join(' → ');
    const a = (act.sequence || ['(not a stream)']).join(' → ');
    if (r !== a) diffs.push({ kind: 'sequence', path: '(events)', reference: r, actual: a });
  }
  for (const header of NOTABLE_HEADERS[api]) {
    if (ref.headers.includes(header) && !act.headers.includes(header)) diffs.push({ kind: 'header', path: header, reference: 'present', actual: 'absent' });
  }

  const wholeEvent = (p) => ref.sequence && ref.sequence.includes(p);
  const missing = topmost([...ref.types.keys()].filter((p) => !act.types.has(p))).filter((p) => !wholeEvent(p));
  for (const path of missing) diffs.push({ kind: 'missing', path, reference: show(ref.types.get(path)), actual: 'absent' });
  for (const [path, types] of ref.types) {
    if (act.types.has(path) && !setsEqual(types, act.types.get(path))) diffs.push({ kind: 'type', path, reference: show(types), actual: show(act.types.get(path)) });
  }
  for (const [path, values] of ref.values) {
    if (act.values.has(path) && !setsEqual(values, act.values.get(path))) diffs.push({ kind: 'value', path, reference: show(values), actual: show(act.values.get(path)) });
  }
  const extra = topmost([...act.types.keys()].filter((p) => !ref.types.has(p)));
  for (const path of extra) diffs.push({ kind: 'extra', path, reference: 'absent', actual: show(act.types.get(path)) });

  return diffs;
}

// An accepted path matches as a run of whole segments anywhere in the diff's path, so
// usage.service_tier also covers message_delta.usage.service_tier.
function acceptance(d, accepted) {
  return accepted.find((a) => (!a.kind || a.kind === d.kind) && `.${d.path}.`.includes(`.${a.path}.`));
}

function classify(diffs, accepted) {
  return diffs.map((d) => {
    const match = acceptance(d, accepted);
    return { ...d, accepted: match?.reason, blocking: !match && d.kind !== 'extra' };
  });
}

module.exports = { diff, classify, profile, flatten };
