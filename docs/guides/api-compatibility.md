# API Compatibility Guide

How SheLLM maps to the official OpenAI and Anthropic APIs. Use this guide to understand what works, what's ignored, and what differs when swapping `base_url` from a first-party API to SheLLM.

---

## Quick Start — Drop-in Swap

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:6100/v1",  # SheLLM instead of api.openai.com
    api_key="shellm_your_key_here",       # SheLLM API key, not OpenAI key
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
    api_key="shellm_your_key_here",
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
| `messages` | **Required** | Array of `{ role, content }`. Content can be a string or array of `{ type: "text", text: "..." }` objects |
| `messages[].role` | **Supported** | `system`, `user`, `assistant` |
| `max_tokens` | **Accepted** | Integer 1-128000. Only passed to providers that support it (Cerebras) |
| `temperature` | **Accepted** | Number 0-2 |
| `top_p` | **Accepted** | Number 0-1 |
| `stream` | **Supported** | `true` enables SSE streaming |
| `response_format` | **Accepted** | `{ type: "json_object" }` or `{ type: "text" }` |
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

SheLLM uses its own model identifiers. Use `GET /v1/models` to see what's available. You can define custom aliases via the `SHELLM_ALIASES` env var:

```bash
# Map OpenAI model names to SheLLM providers
SHELLM_ALIASES='{"gpt-4":"claude","gpt-3.5-turbo":"cerebras"}'
```

### 2. Authentication

SheLLM uses its own API keys (created via `/admin/keys`), not OpenAI or Anthropic keys. Pass them in the `Authorization: Bearer <key>` header — same header format both APIs use.

### 3. `temperature` Range

- **OpenAI endpoint** (`/v1/chat/completions`): 0-2 (matches OpenAI spec)
- **Anthropic endpoint** (`/v1/messages`): 0-1 (matches Anthropic spec)

If you're swapping between endpoints, be aware of the different valid ranges.

### 4. `max_tokens` Requirement

- **OpenAI endpoint**: Optional (defaults vary by provider)
- **Anthropic endpoint**: **Required** (per Anthropic spec). Requests without `max_tokens` return 400.

### 5. Token Usage

- **Non-streaming**: Both endpoints return token counts when available from the provider. Values may be `null` if the provider doesn't report them.
- **Streaming (Anthropic)**: The `message_delta` event includes an estimated `output_tokens` count based on response length (~4 chars per token). This is an approximation, not an exact count.

### 6. Content Format

Both endpoints accept content as a string or as an array of content parts:

```json
// String (simple)
{ "role": "user", "content": "Hello" }

// Array of parts (multimodal-compatible format)
{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }
```

Only `text` type blocks are supported. Image, audio, and tool_use blocks are rejected with a 400 error.

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
| **Vision / Images** | Rejected (400) | Image content blocks return an error |
| **Embeddings** | Not available | No `/v1/embeddings` endpoint |
| **File uploads** | Not available | No file API |
| **Batch API** | Not available | No batch endpoint |
| **Assistants API** | Not available | OpenAI-specific |

---

## Provider Capability Matrix

Not all SheLLM providers support all parameters equally:

| Capability | Claude | Gemini | Codex | Cerebras |
|---|---|---|---|---|
| System prompt | Native | Prepended to prompt | Prepended to prompt | Native |
| Temperature | Passed | Passed | Ignored | Passed |
| Top P | Ignored | Ignored | Ignored | Passed |
| Max tokens | Ignored | Ignored | Ignored | Passed |
| JSON mode | Appends instruction | Appends instruction | Appends instruction | API parameter |
| Streaming | Native | Buffer-and-flush | Native | Native |

"Buffer-and-flush" means the provider doesn't support true streaming — SheLLM waits for the full response, then sends it as a single SSE chunk.

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
