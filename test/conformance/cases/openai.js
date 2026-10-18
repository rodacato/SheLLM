'use strict';

const { PNG_1PX, UNKNOWN_MODEL } = require('./shared');

const CHAT = '/v1/chat/completions';
const SAY_OK = [{ role: 'user', content: 'Reply with the single word OK.' }];
const COUNT = [{ role: 'user', content: 'Count from 1 to 5, one number per line, nothing else.' }];
const LONG = [{ role: 'user', content: 'Write a paragraph about the sea.' }];
const COLOR_SCHEMA = { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false };

const NO_STOP_CONTROL = 'No CLI has a token cap or a stop-sequence flag, so a turn always ends as stop';
const NOTHING_TO_REPORT = 'Optional in the SDK\'s types; nothing to report';

// api-compatibility.md, "Known differences".
const ACCEPTED = [
  { path: 'system_fingerprint', reason: NOTHING_TO_REPORT },
  { path: 'service_tier', reason: NOTHING_TO_REPORT },
];

const CASES = [
  { id: 'O01-buffered', title: 'Buffered single turn', path: CHAT, body: { model: '$MODEL', messages: SAY_OK } },
  { id: 'O02-streaming', title: 'Streamed single turn', path: CHAT, body: { model: '$MODEL', stream: true, messages: SAY_OK } },
  { id: 'O03-streaming-usage', title: 'Streamed with include_usage', path: CHAT, body: { model: '$MODEL', stream: true, stream_options: { include_usage: true }, messages: SAY_OK } },
  { id: 'O04-system', title: 'System message', path: CHAT, body: { model: '$MODEL', messages: [{ role: 'system', content: 'Answer in uppercase.' }, ...SAY_OK] } },
  {
    id: 'O05-multi-turn', title: 'Three-message conversation', path: CHAT,
    body: {
      model: '$MODEL', messages: [
        { role: 'user', content: 'My name is Ada.' },
        { role: 'assistant', content: 'Nice to meet you, Ada.' },
        { role: 'user', content: 'What is my name? One word.' },
      ],
    },
  },
  { id: 'O06-developer-role', title: 'developer message instead of system', path: CHAT, body: { model: '$MODEL', messages: [{ role: 'developer', content: 'Answer in uppercase.' }, ...SAY_OK] } },
  { id: 'O07-content-parts', title: 'User content as text parts', path: CHAT, body: { model: '$MODEL', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word OK.' }] }] } },

  { id: 'P01-models-list', title: 'List models', method: 'GET', path: '/v1/models' },
  { id: 'P02-models-retrieve', title: 'Retrieve one model', method: 'GET', path: '/v1/models/$MODEL' },
  {
    id: 'P03-max-tokens-cap', title: 'max_tokens small enough to cut the answer', path: CHAT,
    body: { model: '$MODEL', max_tokens: 5, messages: LONG },
    accepted: [{ path: 'choices[].finish_reason', kind: 'value', reason: NO_STOP_CONTROL }],
  },
  {
    id: 'P04-max-completion-tokens', title: 'max_completion_tokens, the newer cap', path: CHAT,
    body: { model: '$MODEL', max_completion_tokens: 5, messages: LONG },
    accepted: [{ path: 'choices[].finish_reason', kind: 'value', reason: NO_STOP_CONTROL }],
  },
  {
    id: 'P05-stop', title: 'A stop string the answer reaches', path: CHAT,
    body: { model: '$MODEL', stop: ['3'], messages: COUNT },
  },
  { id: 'P06-n', title: 'n = 2', path: CHAT, body: { model: '$MODEL', n: 2, messages: SAY_OK } },
  { id: 'P07-json-object', title: 'response_format json_object', path: CHAT, body: { model: '$MODEL', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Give me one primary color as JSON with a "color" key.' }] } },
  {
    id: 'P08-json-schema', title: 'response_format json_schema, strict', path: CHAT,
    body: { model: '$MODEL', response_format: { type: 'json_schema', json_schema: { name: 'color', strict: true, schema: COLOR_SCHEMA } }, messages: [{ role: 'user', content: 'Give me one primary color.' }] },
  },
  { id: 'P09-logprobs', title: 'logprobs requested', path: CHAT, body: { model: '$MODEL', logprobs: true, top_logprobs: 2, messages: SAY_OK } },
  { id: 'P10-extras', title: 'seed, user, penalties', path: CHAT, body: { model: '$MODEL', seed: 42, user: 'conformance', frequency_penalty: 0.1, presence_penalty: 0.1, temperature: 0.7, messages: SAY_OK } },
  { id: 'P11-reasoning-effort', title: 'reasoning_effort', path: CHAT, body: { model: '$MODEL', reasoning_effort: 'low', messages: SAY_OK } },

  { id: 'Q01-missing-model', title: 'No model', path: CHAT, body: { messages: SAY_OK } },
  { id: 'Q02-missing-messages', title: 'No messages', path: CHAT, body: { model: '$MODEL' } },
  { id: 'Q03-empty-messages', title: 'Empty messages array', path: CHAT, body: { model: '$MODEL', messages: [] } },
  { id: 'Q04-temperature-range', title: 'temperature 3', path: CHAT, body: { model: '$MODEL', temperature: 3, messages: SAY_OK } },
  { id: 'Q05-unknown-model', title: 'A model that does not exist', path: CHAT, body: { model: `gpt-${UNKNOWN_MODEL}`, messages: SAY_OK } },
  { id: 'Q06-invalid-key', title: 'Wrong API key', path: CHAT, auth: 'invalid', body: { model: '$MODEL', messages: SAY_OK } },
  { id: 'Q07-malformed-json', title: 'Body that is not JSON', path: CHAT, rawBody: '{"model": ' },
  { id: 'Q08-unknown-route', title: 'Route that does not exist', path: '/v1/does-not-exist', body: {} },
  {
    id: 'Q09-tools', title: 'A non-empty tools list', path: CHAT,
    body: { model: '$MODEL', tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }], messages: SAY_OK },
  },
  { id: 'Q10-unknown-role', title: 'A role that does not exist', path: CHAT, body: { model: '$MODEL', messages: [{ role: 'robot', content: 'Hi.' }] } },
  {
    id: 'Q11-schema-not-strict-compatible', title: 'json_schema strict without additionalProperties false', path: CHAT,
    body: { model: '$MODEL', response_format: { type: 'json_schema', json_schema: { name: 'color', strict: true, schema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } } }, messages: SAY_OK },
  },

  {
    id: 'R01-image-data-url', title: 'Image as a data URL', path: CHAT,
    body: {
      model: '$MODEL', messages: [{
        role: 'user', content: [
          { type: 'text', text: 'What color is this pixel? One word.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
        ],
      }],
    },
  },
  {
    id: 'R02-image-corrupt', title: 'Data URL that is not an image', path: CHAT,
    body: {
      model: '$MODEL', messages: [{
        role: 'user', content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,bm90IGFuIGltYWdl' } },
        ],
      }],
    },
  },

  {
    id: 'S01-streaming-cap', title: 'Streamed answer cut by max_tokens', path: CHAT,
    body: { model: '$MODEL', max_tokens: 5, stream: true, messages: LONG },
    accepted: [{ path: 'chunk.choices[].finish_reason', kind: 'value', reason: NO_STOP_CONTROL }],
  },
  { id: 'S02-streaming-unknown-model', title: 'Streamed request for a model that does not exist', path: CHAT, body: { model: `gpt-${UNKNOWN_MODEL}`, stream: true, messages: SAY_OK } },
  {
    id: 'S03-streaming-json-schema', title: 'Streamed json_schema', path: CHAT,
    body: { model: '$MODEL', stream: true, response_format: { type: 'json_schema', json_schema: { name: 'color', strict: true, schema: COLOR_SCHEMA } }, messages: [{ role: 'user', content: 'Give me one primary color.' }] },
  },

  { id: 'T01-responses-api', title: 'The Responses API, to measure the distance', path: '/v1/responses', body: { model: '$MODEL', input: 'Reply with the single word OK.' } },
];

module.exports = { api: 'openai', CASES, ACCEPTED };
