# API Compatibility Guide

How SheLLM maps to the official OpenAI and Anthropic APIs. Use this guide to understand what works, what's ignored, and what differs when swapping `base_url` from a first-party API to SheLLM.

---

## Quick Start — Drop-in Swap

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:6100/v1",  # SheLLM instead of api.openai.com
    api_key="shellm-your-key-here",       # SheLLM API key, not OpenAI key
)

response = client.chat.completions.create(
    model="claude",  # SheLLM model name (see GET /v1/models)
    messages=[{"role": "user", "content": "Hello"}],
)
```

### Anthropic SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:6100",     # SheLLM instead of api.anthropic.com
    api_key="shellm-your-key-here",
)

message = client.messages.create(
    model="claude",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

---

## Endpoint Mapping

| Official API | SheLLM Endpoint | Format |
|---|---|---|
| `POST /v1/chat/completions` (OpenAI) | `POST /v1/chat/completions` | OpenAI |
| `POST /v1/messages` (Anthropic) | `POST /v1/messages` | Anthropic |
| `GET /v1/models` (OpenAI) | `GET /v1/models` | OpenAI |

---

## Supported Parameters

### POST /v1/chat/completions (OpenAI format)

| Parameter | Status | Notes |
|---|---|---|
| `model` | **Required** | Must be a SheLLM model name (see `/v1/models`) |
| `messages` | **Required** | Array of `{ role, content }`. Content can be a string or an array of `text` and `image_url` parts (§6) |
| `messages[].role` | **Supported** | `system`, `user`, `assistant` |
| `max_tokens` | **Accepted** | Integer 1-128000. Validated, then ignored — no CLI has a token-cap flag, so it does not shorten the answer |
| `temperature` | **Accepted** | Number 0-2 |
| `top_p` | **Accepted** | Number 0-1 |
| `reasoning_effort` | **Supported** | `minimal`, `low`, `medium` or `high`; `minimal` runs as `low`, the floor both CLIs accept. Omitted, Claude uses `SHELLM_CLAUDE_EFFORT` (`medium`) and Codex its own configuration. Any other value is a 400 |
| `stream` | **Supported** | `true` enables SSE streaming |
| `response_format` | **Supported** | `{ type: "json_schema", json_schema: { name, schema, strict? } }`, `{ type: "json_object" }` or `{ type: "text" }`. `name` is 1–64 letters, digits, `_` or `-`; the schema is at most 100 KiB, because Claude takes it as one command-line argument. The answer is the JSON as a string in `choices[0].message.content`; streamed, it arrives as `delta.content` like any other answer |
| `stop` | **Validated** | String or array of up to 4 strings. Validated but not passed to providers |
| `n` | **Ignored** | Always returns 1 choice |
| `seed` | **Ignored** | |
| `user` | **Ignored** | |
| `frequency_penalty` | **Ignored** | |
| `presence_penalty` | **Ignored** | |
| `logprobs` | **Ignored** | |
| `top_logprobs` | **Ignored** | |
| `logit_bias` | **Ignored** | |
| `tools` / `tool_choice` | **Ignored** | Function calling not yet supported |

### POST /v1/messages (Anthropic format)

| Parameter | Status | Notes |
|---|---|---|
| `model` | **Required** | Must be a SheLLM model name |
| `max_tokens` | **Required** | Integer 1-128000. Required per Anthropic spec |
| `messages` | **Required** | Array of `{ role, content }`. Content can be string or `[{ type: "text", text: "..." }]` |
| `messages[].role` | **Supported** | `user`, `assistant` (no `system` in messages — use top-level `system`) |
| `system` | **Accepted** | String or array of `{ type: "text", text: "..." }` blocks |
| `temperature` | **Accepted** | Number 0-1 (stricter than OpenAI's 0-2) |
| `top_p` | **Accepted** | Number 0-1 |
| `stream` | **Supported** | `true` enables Anthropic SSE streaming |
| `stop_sequences` | **Validated** | Array of strings. Validated but not passed to providers |
| `metadata` | **Ignored** | |
| `top_k` | **Ignored** | |
| `tools` / `tool_choice` | **Ignored** | Tool use not yet supported |

---

## Key Differences from Official APIs

### 1. Model Names

Model names map to the CLI's own aliases — `claude-haiku` becomes `--model haiku`. `GET /v1/models` lists every name that routes plus the models the CLIs report for this account, each with its limits: `context_window`, `context_window_1m`, `reasoning_efforts` and the rest, and in `x_shellm.sources` whether each came from the CLI, from the hand-kept manifest (`config/model-limits.yaml`) or from the 200,000-token default ([ADR-0009](../adr/0009-model-limits-manifest.md)). The limits inform; they never reject a request. Any other `claude-*` id is passed through to the CLI unchanged.

**1M context** is asked for the way the Anthropic API asks for it: the same model id plus the header `anthropic-beta: context-1m-<date>` (any date), on `/v1/messages` or `/v1/chat/completions`. SheLLM then runs the CLI's `<alias>[1m]`. It applies to a named model the CLI lists a 1M variant for (`claude-sonnet`, `claude-opus`, `claude-fable` on the account this was written on); `claude-haiku` and the bare `claude` ignore it and run at 200k.

A name no provider owns (`gpt-4o`) is rejected with 400 `invalid_request` before any process starts. A `claude-*` name the CLI itself rejects comes back as 404 `model_not_found`.

### 2. Authentication

SheLLM uses its own API keys (created via `/admin/keys`), not OpenAI or Anthropic keys. Pass them in the `Authorization: Bearer <key>` header — same header format both APIs use.

### 3. `temperature` Range

- **OpenAI endpoint** (`/v1/chat/completions`): 0-2 (matches OpenAI spec)
- **Anthropic endpoint** (`/v1/messages`): 0-1 (matches Anthropic spec)

If you're swapping between endpoints, be aware of the different valid ranges.

The claude and codex CLIs have no temperature flag, so SheLLM validates the value and ignores it for them.

### 4. `max_tokens` Requirement

- **OpenAI endpoint**: Optional (defaults vary by provider)
- **Anthropic endpoint**: **Required** (per Anthropic spec). Requests without `max_tokens` return 400.

### 5. Token Usage

- **Non-streaming**: Both endpoints return the token counts the CLI reports, each in its API's own terms. On `/v1/chat/completions`, `prompt_tokens` counts every input token and `prompt_tokens_details.cached_tokens` says how many came from the cache; `completion_tokens` includes the reasoning, broken out in `completion_tokens_details.reasoning_tokens`. On `/v1/messages`, `input_tokens` is only the uncached part, with `cache_creation_input_tokens` and `cache_read_input_tokens` beside it, as Anthropic reports them. Values may be `null` if the provider doesn't report them.
- **Streaming (Anthropic)**: `message_start` carries an *estimated* `input_tokens` (~4 chars per token) because the real count is not known when the stream opens. `message_delta` carries the CLI's own `output_tokens`, `input_tokens` and cache counts, and falls back to the same estimate only if the provider reports none.

### 6. Content Format

Both endpoints accept content as a string or as an array of content parts:

```json
// String (simple)
{ "role": "user", "content": "Hello" }

// Array of parts (multimodal-compatible format)
{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }
```

On `/v1/chat/completions` a `user` message may also carry images, as OpenAI's `image_url` parts:

```json
{ "role": "user", "content": [
  { "type": "text", "text": "Photo 1: front" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/4AAQ…", "detail": "high" } }
] }
```

- **Only `data:` URLs** of `image/jpeg`, `image/png`, `image/webp` or `image/gif`. A remote URL
  is a 400: fetching whatever address a caller names, from the server, is an SSRF.
- **Limits:** `SHELLM_MAX_IMAGES` per request (default 8, counted across every message; `0` turns
  images off) and `SHELLM_MAX_IMAGE_BYTES` per image, decoded (default 5 MiB). The body of this
  endpoint may be up to `SHELLM_MAX_CHAT_BODY_BYTES` (default 20 MiB, a 413 beyond it); every other
  endpoint stays at 256 kB.
- **The bytes must match the declared type.** A PNG labelled `image/jpeg` is a 400 here instead of
  a 502 from the provider.
- **Every refusal is a 400 whose message names the image**, so a client can drop them and retry
  as text.
- `detail` is accepted and ignored. Resize before sending: Claude scales anything over about
  1568 px on its long edge down anyway, so a larger photo only costs upload time.

The prompt stays one flattened string (§1), and each image keeps its place in it as an
`[image N]` marker. Claude receives the real interleaving; Codex receives the images as
attachments and the markers tell them apart.

Audio and tool_use blocks are rejected with a 400, and `/v1/messages` still accepts text blocks
only.

### 7. Streaming Format

- **OpenAI** (`/v1/chat/completions`): `data: {...}\n\n` chunks with `data: [DONE]\n\n` terminator. Each chunk is a `chat.completion.chunk` object.
- **Anthropic** (`/v1/messages`): Named SSE events (`event: message_start`, `event: content_block_delta`, etc.) following the Anthropic streaming protocol.

### 8. Error Formats

Each endpoint returns errors in its respective API's format:

**OpenAI errors** (`/v1/chat/completions`):
```json
{
  "error": {
    "message": "Missing required field: model",
    "type": "invalid_request_error",
    "code": "invalid_request",
    "param": null
  }
}
```

A prompt past the model's context window is a 400 `context_length_exceeded` carrying the CLI's own
count, for example `limit 200000`. There is no separate character cap: the body limit and the
model's window are the bounds.

**Anthropic errors** (`/v1/messages`):
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Missing required field: model"
  }
}
```

### 9. Rate Limiting

SheLLM has its own rate limiting (configurable per API key and globally). Rate limit errors return 429 with a `Retry-After` header, matching both APIs' conventions.

---

## What's NOT Supported

These features are not implemented and will be silently ignored or rejected:

| Feature | Status | Both APIs |
|---|---|---|
| **Function calling / Tools** | Ignored | `tools`, `tool_choice` are accepted but have no effect |
| **Images by URL** | Rejected (400) | Only inline `data:` URLs on `/v1/chat/completions` (§6); `/v1/messages` takes text only |
| **Embeddings** | Not available | No `/v1/embeddings` endpoint |
| **File uploads** | Not available | No file API |
| **Batch API** | Not available | No batch endpoint |
| **Assistants API** | Not available | OpenAI-specific |

---

## Provider Capability Matrix

Not all SheLLM providers support all parameters equally:

| Capability | Claude | Codex |
|---|---|---|
| Prompt | stdin: plain text, or one stream-json message when it carries images. Never an argument, which Linux caps at 128 KiB | stdin (`-`), with the system prompt prepended |
| System prompt | `--system-prompt-file`, the text in a `0600` file in the request's directory | Prepended to the prompt |
| Reasoning effort | `--effort` | `-c model_reasoning_effort="<level>"` |
| Temperature | Ignored — no CLI flag | Ignored — no CLI flag |
| Top P | Ignored — no CLI flag | Ignored — no CLI flag |
| Max tokens | Ignored — no CLI flag | Ignored — no CLI flag |
| JSON mode (`json_object`) | Appends an instruction | Appends an instruction |
| JSON Schema (`json_schema`) | `--json-schema`, the answer is the CLI's `structured_output`. Streamed, it arrives whole in one chunk once the CLI has validated it, never piece by piece: when the model's first attempt fails the schema the CLI asks again, and pieces of the failed attempt could not be taken back. Keepalive comments hold the connection meanwhile. A turn that ends without it is a 502 | `--output-schema` with the schema in a `0600` file in the request's directory. OpenAI's strict mode applies whatever `strict` says: a schema without `additionalProperties: false` and every property in `required` is a 400 naming `response_format` |
| Images | One stream-json user message on stdin (`--input-format stream-json`), images as base64 blocks in place; never written to disk | `-i image-N.<ext>` per image, each a `0600` file in the request's directory, removed with it on success, failure or disconnect |
| Streaming | Token deltas (`--output-format stream-json`) | Whole messages — it yields on `item.completed`, not per token |

Codex runs `codex exec --ephemeral --skip-git-repo-check -s read-only --json`, one process at a time: concurrent processes race on its OAuth refresh (openai/codex#17340). A failed turn is read from the events, never from the exit code, which can be 0 on a failure (openai/codex#1018).

Bare `codex` resolves to the default from the baked catalog, **not** to `~/.codex/config.toml`: without `-m` the CLI falls back to whatever that file names, and a ChatGPT account answers *"model is not supported"* to it. `codex-<model>` passes `<model>` to `-m` directly.

---

## Testing Compatibility

To verify your client works with SheLLM, send a request with extra fields that your SDK might include:

```bash
# OpenAI-style with extra fields (should succeed — extras are ignored)
curl -X POST http://localhost:6100/v1/chat/completions \
  -H "Authorization: Bearer $SHELLM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 0.7,
    "n": 1,
    "seed": 42,
    "user": "test"
  }'

# Anthropic-style with system as array
curl -X POST http://localhost:6100/v1/messages \
  -H "Authorization: Bearer $SHELLM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "max_tokens": 1024,
    "system": [{"type": "text", "text": "Be concise."}],
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
