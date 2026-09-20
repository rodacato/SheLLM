# Using SheLLM from your own code

You have a running SheLLM, its base URL and an API key. This guide takes you from there to a
working call, and says plainly what the API can and cannot do today.

Everything below was probed against a running instance of **this** build on **2026-09-19**, with
**Claude as the only provider** (`GET /v1/models` returns `claude`, `claude-haiku`,
`claude-sonnet`, `claude-opus`). The probes that produced the verdicts are in
[`scripts/bench.js`](../../scripts/bench.js); the latency numbers are in
[`benchmarks.md`](./benchmarks.md). Re-run them after a deploy:
`node scripts/bench.js --suite capabilities`.

- Installing a server: [`../../README.md`](../../README.md) and [`deployment.md`](./deployment.md)
- Parameter-by-parameter mapping: [`api-compatibility.md`](./api-compatibility.md)
- Every field and status, as a machine-readable contract: [`../api/openapi.yaml`](../api/openapi.yaml).
  Your own instance serves the bundled copy at `$SHELLM_BASE/docs/openapi.json`, so a client
  generator can read the version that host is actually running.

## 1. What you need

```bash
export SHELLM_BASE=https://shellm.example.com   # your instance
export SHELLM_KEY=shellm-...                    # printed by `shellm init`, or created in /admin
```

The key goes in `Authorization: Bearer <key>` or `x-api-key` — both work on both endpoints. Keys
are per application, not per person: create one per app so you can rotate or revoke it alone.

## 2. First call

```bash
curl -s "$SHELLM_BASE/v1/chat/completions" \
  -H "Authorization: Bearer $SHELLM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude", "messages": [{"role": "user", "content": "Reply with one word: pong"}]}'
```

The Anthropic endpoint takes the Anthropic shape, including the required `max_tokens`:

```bash
curl -s "$SHELLM_BASE/v1/messages" \
  -H "x-api-key: $SHELLM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude", "max_tokens": 256, "messages": [{"role": "user", "content": "Hola"}]}'
```

## 3. From an SDK

No client code changes — only the base URL and the key.

```python
from openai import OpenAI

client = OpenAI(base_url=f"{SHELLM_BASE}/v1", api_key=SHELLM_KEY)
answer = client.chat.completions.create(
    model="claude-sonnet",
    messages=[{"role": "user", "content": "Hola"}],
)
```

```python
import anthropic

client = anthropic.Anthropic(base_url=SHELLM_BASE, api_key=SHELLM_KEY)
answer = client.messages.create(
    model="claude-sonnet",
    max_tokens=1024,
    system="Answer in Spanish.",
    messages=[{"role": "user", "content": "Hola"}],
)
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({ baseURL: `${process.env.SHELLM_BASE}/v1`, apiKey: process.env.SHELLM_KEY });
const answer = await client.chat.completions.create({
  model: 'claude-sonnet',
  messages: [{ role: 'user', content: 'Hola' }],
});
```

```ruby
require 'net/http'
require 'json'

uri = URI("#{ENV['SHELLM_BASE']}/v1/chat/completions")
response = Net::HTTP.post(
  uri,
  { model: 'claude-sonnet', messages: [{ role: 'user', content: 'Hola' }] }.to_json,
  'Authorization' => "Bearer #{ENV['SHELLM_KEY']}",
  'Content-Type' => 'application/json',
)
answer = JSON.parse(response.body).dig('choices', 0, 'message', 'content')
```

The `ruby-openai` gem works the same way with `uri_base: ENV['SHELLM_BASE']` — it appends `/v1`
itself, so do not include it twice. Set a read timeout of at least 120 s in any client: see §7.

## 4. What works today with Claude

Each row is a probe that ran against a live instance, not a reading of the code. Re-run them with
`node scripts/bench.js --suite capabilities`.

| What you want to do | Verdict | What actually happens |
|---|---|---|
| List the usable models (`models`) | works | `GET /v1/models` returns the four Claude ids |
| Hold a conversation (`multi-turn`) | works | the whole `messages` history reaches the model |
| Steer with a system prompt (`system`) | works | top-level `system` on `/v1/messages`, or a `system` role message on `/v1/chat/completions` |
| Get JSON back (`json-mode`) | works | `response_format: {"type": "json_object"}` returns parseable JSON |
| Stream tokens, OpenAI style (`stream-openai`) | works | SSE `data:` chunks, `[DONE]` terminator |
| Stream tokens, Anthropic style (`stream-anthropic`) | works | named events, first one arrives early (§8) |
| Send a long prompt (`long-context`) | works | ~4k tokens accepted, and it barely costs latency |
| Send the fields your SDK adds anyway (`sdk-extras`) | works | `temperature`, `top_p`, `stop`, `seed`, `n`, `user` are accepted |
| Cap the answer length (`max-tokens`) | ignored | the claude CLI has no such flag: `max_tokens: 16` still returned 3 000 characters. Bound the length in the prompt |
| Call functions / use tools (`tools`) | ignored | `tools` is accepted and has no effect — no `tool_calls` ever come back |
| Send an image (`images`) | rejected | 400, text blocks only |
| Use a model no provider owns (`unknown-model`) | rejected | 400 `invalid_request` — e.g. `gpt-4o` |
| Use a `claude-*` name the CLI rejects (`unknown-claude-model`) | rejected | 404 `model_not_found` |
| Call without a key (`auth`) | rejected | 401 in your endpoint's own error shape |
| POST more than 256 kB (`payload-limit`) | rejected | 413 |
| Get embeddings (`embeddings`) | rejected | 404, there is no embeddings endpoint |

Two error-shape probes are part of the same suite, because an SDK reads the error body, not just
the status:

| Probe | Verdict | Detail |
|---|---|---|
| Validation errors keep each endpoint's shape (`error-format-4xx`) | works | OpenAI errors on `/v1/chat/completions`, Anthropic errors on `/v1/messages` |
| A 401 keeps each endpoint's shape (`error-format-401`) | works | it did not until 2026-09-19: both endpoints used to answer `{"error": "auth_required", …}`, SheLLM's own shape, so `error.message` read through an SDK came back empty |

## 5. Streaming

```bash
curl -N "$SHELLM_BASE/v1/chat/completions" \
  -H "Authorization: Bearer $SHELLM_KEY" -H "Content-Type: application/json" \
  -d '{"model": "claude", "stream": true, "messages": [{"role": "user", "content": "Cuenta hasta diez"}]}'
```

Both endpoints stream the answer as the model writes it: with `claude-sonnet`, the first text
reaches the client about 1.7 s into a 5.5 s request, in dozens of chunks.

Two caveats:

- On `/v1/messages` the `message_start` event arrives immediately, before the CLI has produced
  anything. Do not treat it as the first token — wait for `content_block_delta`.
- `claude-haiku` is the exception: its first text still arrives at the very end, for reasons that
  are not SheLLM's and not yet understood ([`benchmarks.md`](./benchmarks.md)). Stream with
  `claude-sonnet`.

## 6. Errors

Every response carries an `x-request-id` header, and the server logs the same id — quote it when
something is wrong. You can also set it yourself to correlate with your own logs.

| Status | Code | What it means | What to do |
|---|---|---|---|
| 400 | `invalid_request` | bad field, unknown model name, or an image block | fix the request; the message names the field |
| 401 | `auth_required` | missing, unknown or deactivated key | check the key |
| 404 | `model_not_found` | the CLI does not know that `claude-*` model | use one from `GET /v1/models` |
| 413 | — | body over 256 kB | send less; a 4k-token prompt is nowhere near this |
| 429 | `rate_limited` | per-key or global rate limit, or the queue is full | honor `Retry-After`; do not hammer |
| 502 | `cli_failed` | the CLI exited with an error | check the admin dashboard logs |
| 503 | `provider_unavailable` | provider disabled, not logged in, or its circuit is open | the CLI login probably expired |
| 504 | `timeout` | killed after `TIMEOUT_MS` (120 s by default) | shorten the work or raise the limit |

SheLLM never retries for you, by design. If you retry, do it on 502/503/504 with a backoff, and
never on 429 before `Retry-After`.

## 7. Limits you will hit

| Limit | Default | Consequence |
|---|---|---|
| `MAX_CONCURRENT` | 2 | a third simultaneous request waits in the queue |
| `MAX_QUEUE_DEPTH` | 10 | past that, 429 instead of a longer wait |
| `MAX_STREAM_CONCURRENT` | 2 | streaming slots are counted separately |
| Global rate limit | 30 req/min | shared by every key |
| Per-key rate limit | set when the key is created | 429 with `Retry-After` |
| `TIMEOUT_MS` | 120 000 | the CLI process is killed and you get a 504 |
| Request body | 256 kB | 413 |

This is a personal subscription behind a CLI: it is sized for a person's work, not for a job
queue. Set your client timeout above 120 s, keep concurrency at or below 2, and do not point a
batch process at it.

## 8. What it costs in time

Measured on the production server through a Cloudflare Tunnel, median of 3 ([`benchmarks.md`](./benchmarks.md)):

- A short answer costs about **3 s**, whichever model you pick — the CLI's startup dominates.
- Prompt size barely matters: a ~4k-token prompt lands within a second of a ten-token one.
- Answer length is what costs: a 100-word answer ~6 s, a 500-word answer considerably more.
- Streaming shows the first text at about **1.7 s** with `claude-sonnet`, on either endpoint.

So: pick the model for quality, not for speed, and stream when a person is watching.

## 9. What not to do

- Do not put SheLLM behind a coding agent (Claude Code, Cline, Aider) — they drive their own CLI.
- Do not share a key outside your own applications. One subscription, one owner.
- Do not run batch or high-volume work through it. That is what paid API credit is for.
- Do not retry automatically on 429. That is how a subscription gets flagged.
