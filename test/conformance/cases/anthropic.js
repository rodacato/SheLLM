'use strict';

const { PNG_1PX, UNKNOWN_MODEL } = require('./shared');

const MESSAGES = '/v1/messages';
const SAY_OK = [{ role: 'user', content: 'Reply with the single word OK.' }];
const COUNT = [{ role: 'user', content: 'Count from 1 to 5, one number per line, nothing else.' }];
const LONG = [{ role: 'user', content: 'Write a paragraph about the sea.' }];

const NO_STOP_CONTROL = 'No CLI has a token cap or a stop-sequence flag, so a turn always ends as end_turn';
const MODELS_SHAPE = 'Not supported yet: /v1/models answers in the OpenAI shape for both formats';

// Fields the CLI reports about its own billing, absent on purpose: api-compatibility.md, "Known differences".
const ACCEPTED = [
  { path: 'usage.cache_creation', reason: 'Describes the CLI call\'s own billing' },
  { path: 'usage.server_tool_use', reason: 'Describes the CLI call\'s own billing' },
  { path: 'usage.service_tier', reason: 'Describes the CLI call\'s own billing' },
  { path: 'usage.inference_geo', reason: 'Describes the CLI call\'s own billing' },
  { path: 'usage.output_tokens_details', reason: 'Describes the CLI call\'s own billing' },
  { path: 'usage.speed', reason: 'Describes the CLI call\'s own billing' },
  // Whether the model thinks is its own choice per request, so any recording may carry a block.
  { path: 'content[].thinking', reason: 'SheLLM returns the answer, never the CLI\'s thinking' },
  { path: 'content[].signature', reason: 'SheLLM returns the answer, never the CLI\'s thinking' },
];

const CASES = [
  { id: 'A01-buffered', title: 'Buffered single turn', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, messages: SAY_OK } },
  { id: 'A02-streaming', title: 'Streamed single turn', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, stream: true, messages: SAY_OK } },
  { id: 'A03-system-string', title: 'Top-level system as a string', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, system: 'Answer in uppercase.', messages: SAY_OK } },
  { id: 'A04-system-blocks', title: 'Top-level system as text blocks', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, system: [{ type: 'text', text: 'Answer in uppercase.' }], messages: SAY_OK } },
  {
    id: 'A05-multi-turn', title: 'Three-message conversation', path: MESSAGES,
    body: {
      model: '$MODEL', max_tokens: 64, messages: [
        { role: 'user', content: 'My name is Ada.' },
        { role: 'assistant', content: 'Nice to meet you, Ada.' },
        { role: 'user', content: 'What is my name? One word.' },
      ],
    },
  },

  {
    id: 'B01-models-list', title: 'List models', method: 'GET', path: '/v1/models',
    accepted: ['data[].capabilities', 'data[].created_at', 'data[].deprecated_at', 'data[].display_name', 'data[].lifecycle', 'data[].line', 'data[].max_input_tokens', 'data[].max_tokens', 'data[].retires_at', 'data[].type', 'first_id', 'has_more', 'last_id'].map((path) => ({ path, kind: 'missing', reason: MODELS_SHAPE })),
  },
  {
    id: 'B02-models-retrieve', title: 'Retrieve one model', method: 'GET', path: '/v1/models/$MODEL',
    accepted: [{ path: '(status)', reason: 'Not supported yet: no /v1/models/{id} route' }],
  },
  {
    id: 'B03-prefill', title: 'Trailing assistant message (prefill)', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 64, messages: [{ role: 'user', content: 'List three colors as a JSON array.' }, { role: 'assistant', content: '[' }] },
  },
  {
    id: 'B04-cache-control', title: 'cache_control on system and user blocks', path: MESSAGES,
    body: {
      model: '$MODEL', max_tokens: 64,
      system: [{ type: 'text', text: 'Answer in uppercase.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word OK.', cache_control: { type: 'ephemeral' } }] }],
    },
  },
  { id: 'B05-thinking-summarized', title: 'Adaptive thinking with a summary', path: MESSAGES, body: { model: '$MODEL', max_tokens: 2048, thinking: { type: 'adaptive', display: 'summarized' }, messages: SAY_OK } },
  { id: 'B06-metadata', title: 'metadata.user_id', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, metadata: { user_id: 'conformance' }, messages: SAY_OK } },
  {
    id: 'B07-stop-sequences', title: 'A stop sequence the answer reaches', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 64, stop_sequences: ['3'], messages: COUNT },
    accepted: [{ path: 'stop_reason', kind: 'value', reason: NO_STOP_CONTROL }, { path: 'stop_sequence', reason: NO_STOP_CONTROL }],
  },
  {
    id: 'B08-max-tokens-cap', title: 'max_tokens small enough to cut the answer', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 5, messages: LONG },
    accepted: [{ path: 'stop_reason', kind: 'value', reason: NO_STOP_CONTROL }],
  },
  {
    id: 'B09-sampling', title: 'temperature and top_k', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 64, temperature: 0.5, top_k: 10, messages: SAY_OK },
    accepted: [{ path: '(status)', reason: 'Current models refuse temperature; SheLLM validates it and ignores it, since no CLI has the flag, rather than break callers that still send it' }],
  },
  {
    id: 'B10-mid-conversation-system', title: 'A system message inside messages', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 1024, messages: [...SAY_OK, { role: 'system', content: 'Answer in lowercase.' }] },
    accepted: [{ path: 'content[].type', kind: 'value', reason: 'The model chose to think here, and SheLLM never returns the CLI\'s thinking' }],
  },

  { id: 'C01-missing-max-tokens', title: 'No max_tokens', path: MESSAGES, body: { model: '$MODEL', messages: SAY_OK } },
  {
    id: 'C02-zero-max-tokens', title: 'max_tokens 0', path: MESSAGES, body: { model: '$MODEL', max_tokens: 0, messages: SAY_OK },
    accepted: [{ path: '(status)', reason: 'max_tokens 0 is the API\'s cache pre-warm; a CLI turn has no cache of the caller\'s to warm' }],
  },
  { id: 'C03-first-assistant', title: 'Conversation starting with assistant', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, messages: [{ role: 'assistant', content: 'Hi.' }, ...SAY_OK] } },
  { id: 'C04-consecutive-users', title: 'Two user messages in a row', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, messages: [{ role: 'user', content: 'Hello.' }, ...SAY_OK] } },
  { id: 'C05-empty-content', title: 'Empty string content', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, messages: [{ role: 'user', content: '' }] } },
  { id: 'C06-empty-messages', title: 'Empty messages array', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, messages: [] } },
  { id: 'C07-temperature-range', title: 'temperature 1.5', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, temperature: 1.5, messages: SAY_OK } },
  { id: 'C08-unknown-model', title: 'A model that does not exist', path: MESSAGES, body: { model: `claude-${UNKNOWN_MODEL}`, max_tokens: 64, messages: SAY_OK } },
  { id: 'C09-invalid-key', title: 'Wrong API key', path: MESSAGES, auth: 'invalid', body: { model: '$MODEL', max_tokens: 64, messages: SAY_OK } },
  { id: 'C10-malformed-json', title: 'Body that is not JSON', path: MESSAGES, rawBody: '{"model": ' },
  {
    id: 'C11-unknown-route', title: 'Route that does not exist', path: '/v1/does-not-exist', body: {},
    accepted: [{ path: 'request_id', kind: 'type', reason: 'The API has no id for an unmatched route; SheLLM has one for every request' }],
  },
  {
    id: 'C12-tools', title: 'A non-empty tools list', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 64, tools: [{ name: 'get_weather', description: 'Get the weather', input_schema: { type: 'object', properties: {} } }], messages: SAY_OK },
    accepted: [{ path: '(status)', reason: 'Function calling is refused rather than answered in prose: the CLIs run with their tools off (ADR-0002)' }],
  },

  {
    id: 'D01-image-base64', title: 'Base64 image block', path: MESSAGES,
    body: {
      model: '$MODEL', max_tokens: 64, messages: [{
        role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX } },
          { type: 'text', text: 'What color is this pixel? One word.' },
        ],
      }],
    },
    accepted: [{ path: '(status)', reason: 'Not supported yet: /v1/messages takes text blocks only; /v1/chat/completions takes images' }],
  },
  {
    id: 'D02-structured-output', title: 'output_config.format json_schema', path: MESSAGES,
    body: {
      model: '$MODEL', max_tokens: 256, messages: [{ role: 'user', content: 'Give me one primary color.' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false } } },
    },
  },
  { id: 'D03-effort', title: 'output_config.effort', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, output_config: { effort: 'low' }, messages: SAY_OK } },
  {
    id: 'D04-count-tokens', title: 'Token counting endpoint', path: '/v1/messages/count_tokens', body: { model: '$MODEL', messages: SAY_OK },
    accepted: [{ path: '(status)', reason: 'Not supported: no CLI counts tokens without running a turn' }],
  },

  {
    id: 'E01-streaming-cap', title: 'Streamed answer cut by max_tokens', path: MESSAGES,
    body: { model: '$MODEL', max_tokens: 5, stream: true, messages: LONG },
    accepted: [{ path: 'message_delta.delta.stop_reason', kind: 'value', reason: NO_STOP_CONTROL }],
  },
  {
    id: 'E02-streaming-unknown-model', title: 'Streamed request for a model that does not exist', path: MESSAGES,
    body: { model: `claude-${UNKNOWN_MODEL}`, max_tokens: 64, stream: true, messages: SAY_OK },
    accepted: [{ path: '(status)', reason: 'Any claude-* name passes to the CLI, which is the first to know it does not exist, after the stream opened; the error arrives as an error event' }],
  },
  { id: 'E03-streaming-system-multi-turn', title: 'Streamed conversation with a system prompt', path: MESSAGES, body: { model: '$MODEL', max_tokens: 64, stream: true, system: 'Answer in uppercase.', messages: [{ role: 'user', content: 'Hello.' }, { role: 'assistant', content: 'Hi.' }, ...SAY_OK] } },
];

module.exports = { api: 'anthropic', CASES, ACCEPTED };
