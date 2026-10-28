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

## 3. Naming a model

A model name is `<provider>-<the CLI's own name for the model>`. The prefix picks the provider,
the rest is what reaches the CLI.

| You send | What runs |
|---|---|
| `claude` | the `claude` CLI with no `--model` — its own default |
| `claude-sonnet`, `claude-opus`, `claude-haiku` | `--model sonnet` / `opus` / `haiku`, or the CLI's `<alias>[1m]` where the catalog lists a 1M-context variant ([`api-compatibility.md`](./api-compatibility.md#1-model-names)) |
| any other `claude-*` the catalog knows | the prefix comes off: `claude-fable` runs `--model fable` |
| anything else | `--model` with the name unchanged, so a full id like `claude-sonnet-4-5-20250929` works |
| `codex` | `-m` with the default from the baked catalog, not the CLI's own |
| `codex-gpt-5.6-sol` | `-m gpt-5.6-sol` |

Any string starting with `claude-` or `codex-` routes; there is no whitelist. A name the CLI does
not know comes back as 404 `model_not_found`, not as a validation error. Bare `codex` has to name a
model because without `-m` the CLI reads `~/.codex/config.toml`, and a ChatGPT account refuses the
model it usually finds there ([`benchmarks.md`](./benchmarks.md)). That default is read from
`src/catalog/models.json` and never from a live probe — a request must not wait on a spawn.

Three tier aliases are translated unconditionally, because tier names outlive the catalog. Every
other alias the catalog reports — `fable`, `best`, `opusplan`, `default` — is stripped of its
prefix only because the catalog says the CLI answers to it; a name the catalog does not know is
passed through untouched, which is what keeps full model ids working.

`GET /v1/models` lists the names each enabled provider declares plus every model the catalog
knows, once each, with its limits: `context_window`, `context_window_1m`, `reasoning_efforts`,
and in `x_shellm.sources` whether each figure came from the CLI, from the hand-kept
`config/model-limits.yaml`, or from the 200,000-token default ([ADR-0009](../adr/0009-model-limits-manifest.md)).
The limits inform; they never reject a request.

### Where the names come from

SheLLM holds no provider API keys ([`../IDENTITY.md`](../IDENTITY.md)), so the catalog comes from
the binaries. Asking costs no quota: `codex app-server` answers `model/list` with the models this
account can use, including descriptions and retirement dates, and `claude -p '/model'` is answered
by the CLI itself rather than by the API, which is also why the claude entries carry an alias and
nothing else.

The catalog feeds `GET /v1/models` and the admin dashboard's playground — a suggestion list and a retirement warning,
not a restriction on what the field accepts. It has three sources and always reports which one it
used, in the dashboard and in `catalog.source` on `GET /admin/providers`:

| Source | When | What the dashboard says |
|---|---|---|
| `cli` | it asked the installed binaries; cached for `SHELLM_MODEL_CATALOG_TTL_MS` | `claude: asked the CLI` |
| `baked` | the probe failed, so `src/catalog/models.json` answered | `codex: built <date> against CLI <version>`, plus the running version when it differs |
| `declared` | no catalog at all, only the hardcoded tier names | `claude: could not ask — built-in aliases only` |

The baked file is a floor, never the source of truth: your host runs its own binaries under its own
account, and a live probe always wins ([ADR-0005](../adr/0005-model-catalog-from-the-clis.md)).

## 4. From an SDK

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
itself, so do not include it twice. Set a read timeout above the server's `TIMEOUT_MS` in any
client, or stream: see §8.

## 5. What works today with Claude

Each row is a probe that ran against a live instance, not a reading of the code. Re-run them with
`node scripts/bench.js --suite capabilities`.

| What you want to do | Verdict | What actually happens |
|---|---|---|
| List the usable models (`models`) | works | `GET /v1/models` returned the four Claude ids then; since ADR-0009 it also lists the catalog, with limits |
| Hold a conversation (`multi-turn`) | works | the whole `messages` history reaches the model |
| Steer with a system prompt (`system`) | works | top-level `system` on `/v1/messages`, or a `system` role message on `/v1/chat/completions` |
| Get JSON back (`json-mode`) | works | `response_format: {"type": "json_object"}` returns parseable JSON |
| Get JSON that matches a schema (`json-schema`) | works | `response_format: {"type": "json_schema", …}` returns exactly the schema's keys |
| Stream tokens, OpenAI style (`stream-openai`) | works | SSE `data:` chunks, `[DONE]` terminator |
| Stream tokens, Anthropic style (`stream-anthropic`) | works | named events, first one arrives early (§6) |
| Send a long prompt (`long-context`) | works | ~4k tokens accepted, and it barely costs latency |
| Send the fields your SDK adds anyway (`sdk-extras`) | works | `temperature`, `top_p`, `stop`, `seed`, `n`, `user` are accepted |
| Cap the answer length (`max-tokens`) | ignored | the claude CLI has no such flag: `max_tokens: 16` still returned 3 000 characters. Bound the length in the prompt |
| Call functions / use tools (`tools`) | rejected | 400 `unsupported_parameter` naming `tools`. The 2026-09-19 run reported `ignored`; a non-empty `tools` has been refused since, so a caller waiting for a tool call is not handed prose |
| Send an image (`images`) | works | a `data:` URL `image_url` part on `/v1/chat/completions`; a red square came back "Red" |
| Send an image by URL (`remote-image`) | rejected | 400: SheLLM does not fetch remote images |
| Use a model no provider owns (`unknown-model`) | rejected | 400 `invalid_request` — e.g. `gpt-4o` |
| Use a `claude-*` name the CLI rejects (`unknown-claude-model`) | rejected | 404 `model_not_found` |
| Call without a key (`auth`) | rejected | 401 in your endpoint's own error shape |
| POST more than 256 kB (`payload-limit`) | rejected | 413 on `/v1/messages`; `/v1/chat/completions` takes up to `SHELLM_MAX_CHAT_BODY_BYTES` for images |
| Get embeddings (`embeddings`) | rejected | 404, there is no embeddings endpoint |

Two error-shape probes are part of the same suite, because an SDK reads the error body, not just
the status:

| Probe | Verdict | Detail |
|---|---|---|
| Validation errors keep each endpoint's shape (`error-format-4xx`) | works | OpenAI errors on `/v1/chat/completions`, Anthropic errors on `/v1/messages` |
| A 401 keeps each endpoint's shape (`error-format-401`) | works | an SDK reads `error.message` from it like any other error |

**Reasoning effort.** Both models reason before they answer, that reasoning is billed in
`completion_tokens`, and nothing streams while it runs. `reasoning_effort` on
`/v1/chat/completions` (`minimal`, `low`, `medium`, `high`) sets how much, for Claude and Codex
alike; `minimal` runs as `low`, the floor both accept. Without it Claude uses the server's
`SHELLM_CLAUDE_EFFORT` and Codex its own configuration. Filling a JSON schema rarely needs more than `low`.

## 6. Streaming

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

## 7. Errors

Every response carries an `x-request-id` header, and the server logs the same id — quote it when
something is wrong. You can also set it yourself to correlate with your own logs.

| Status | Code | What it means | What to do |
|---|---|---|---|
| 400 | `invalid_request` | bad field, unknown model name, or an image SheLLM does not accept | fix the request; the message names the field |
| 400 | `unsupported_parameter` | the request declares `tools` or forces a tool call; function calling is not supported yet | send it without `tools` |
| 400 | `context_length_exceeded` | the prompt is past the model's context window; the message carries the CLI's count | send less, or split the work |
| 401 | `auth_required` | missing, unknown or deactivated key | check the key |
| 404 | `model_not_found` | the CLI does not know that `claude-*` model | use one from `GET /v1/models` |
| 403 | `origin_not_allowed` | the key is scoped to other browser origins (§10) | call from an allowed page, or widen the key's list |
| 404 | `not_found` | no such route, e.g. `/v1/embeddings` | check the path |
| 413 | `invalid_request` | body over 256 kB, or over `SHELLM_MAX_CHAT_BODY_BYTES` on `/v1/chat/completions` | send less; resize images before sending |
| 429 | `rate_limited` | per-key or global rate limit, or the queue is full | honor `Retry-After`; do not hammer |
| 429 | `spend_limit_exceeded` | the key reached its monthly spend limit (OpenAI type `insufficient_quota`) | wait for the month to reset, or raise the limit; `x-should-retry: false` |
| 502 | `cli_failed` | the CLI exited with an error | check the admin dashboard logs |
| 503 | `provider_unavailable` | provider disabled, not logged in, or its circuit is open | the CLI login probably expired |
| 504 | `timeout` | killed after `TIMEOUT_MS` | shorten the work or raise the limit |

SheLLM never retries for you, by design; the one exception is cross-provider fallback, off unless
the server sets `SHELLM_FALLBACK_ENABLED` or the request sends `x-shellm-allow-fallback: true`. If
you retry, do it on 502/503/504 with a backoff, and never on 429 before `Retry-After`.

## 8. Limits you will hit

Each setting's default is in [`src/config/schema.js`](../../src/config/schema.js); `shellm config`
on the host prints the values actually in effect.

| Limit | Consequence |
|---|---|
| `MAX_CONCURRENT` | requests beyond it wait in the queue |
| `MAX_QUEUE_DEPTH` | past that, 429 instead of a longer wait |
| `MAX_STREAM_CONCURRENT` | streaming slots are counted separately |
| `SHELLM_GLOBAL_RPM` | shared by every key; 429 with `Retry-After` |
| Per-key rate limit, set when the key is created | 429 with `Retry-After` |
| Per-key spend limit, optional, USD of API-equivalent cost per calendar month (UTC) | 429 `spend_limit_exceeded` until the 1st; approximate, the request that crosses it finishes |
| `TIMEOUT_MS` | the CLI process is killed and you get a 504 |
| A proxy in front — Cloudflare waits 100 s for the first byte | a non-streaming answer slower than that gets the proxy's 524, with no CORS headers — a browser sees only "Failed to fetch". Send `stream: true`: headers go out at once and the proxy stops waiting |
| Request body: 256 kB, fixed in [`src/app.js`](../../src/app.js); `SHELLM_MAX_CHAT_BODY_BYTES` on `/v1/chat/completions` | 413 |
| Prompt length: the model's context window; no character cap of SheLLM's own | 400 `context_length_exceeded`, at no cost: the CLI refuses it before calling the model |
| `SHELLM_MAX_IMAGES` per request, `SHELLM_MAX_IMAGE_BYTES` per image, decoded | 400 naming the image |

This is a personal subscription behind a CLI: it is sized for a person's work, not for a job
queue. Set your client timeout above `TIMEOUT_MS`, or stream, keep concurrency at or below
`MAX_CONCURRENT`, and do not point a batch process at it.

## 9. What it costs in time

Measured on the production server through a Cloudflare Tunnel, median of 3 ([`benchmarks.md`](./benchmarks.md)):

- A short answer costs about **2.5 s**, whichever model you pick — roughly 0.9 s of that is the
  CLI's startup, which no model choice changes.
- Prompt size barely matters: a ~4k-token prompt lands within a second of a ten-token one.
- Answer length is what costs: a 100-word answer ~6 s, a 500-word answer considerably more.
- Streaming shows the first text at about **1.7 s** with `claude-sonnet`, on either endpoint.

So: pick the model for quality, not for speed, and stream when a person is watching.

## 10. Calling it from a browser

The server has to allow the page's origin first: `SHELLM_CORS_ORIGINS`, exact match, `/v1` only
([`../../README.md`](../../README.md#using-shellm-from-a-browser)). With it unset, SheLLM sends no
`Access-Control-*` headers at all, so every cross-origin call fails.

### Scope the key to the page

A key can carry its own origin list, set when you create it in the dashboard or over the admin API:

```bash
curl -u admin:$PASSWORD -X POST http://127.0.0.1:6100/admin/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"bench-page","rpm":30,"origins":["https://you.github.io"]}'
```

A request carrying any other `Origin` gets `403 origin_not_allowed`. A key's list narrows
`SHELLM_CORS_ORIGINS`, it never widens it.

**This is a guardrail, not authentication.** `Origin` is set by browsers; anything else holding the
key can send whatever it likes, or nothing at all — a request with no `Origin` is accepted, so
`curl` still works. What the list actually buys you is that a key pasted into the wrong page stops
working, loudly, instead of quietly running up your subscription.

### The key is in the page

Whatever you ship to a browser is public — view-source, devtools, the network tab. Treat a browser
key as published:

- **A dedicated key**, never the one your servers use.
- **A low `rpm`** and a short `expires_at`. A benchmark page needs a few requests a minute.
- **The model list** narrowed to what the page actually calls.
- **Rotate it** when the page changes hands, and after any public demo.

### Six connections, and how to get past them

A browser opens about **six HTTP/1.1 connections per host**. Request seven streams at once and the
seventh does not queue in SheLLM — it waits in the browser, invisible from the server side, which
will quietly ruin a concurrency benchmark.

HTTP/2 lifts that limit, and SheLLM does not serve it: Express 5 on Node's `http2` compat layer
crashes the process on the first HTTP/2 request. Put a proxy in front instead.

```bash
caddy trust                                                   # once, trusts Caddy's local CA
caddy reverse-proxy --from localhost:6443 --to 127.0.0.1:6100
```

The page then talks to `https://localhost:6443` over HTTP/2, and Caddy talks HTTP/1.1 to SheLLM.
Caddy does not buffer SSE, so streaming still arrives token by token. If the proxy is not on the
same machine, set `SHELLM_TRUST_PROXY` (`loopback`, a hop count, or the proxy's address) so the
admin login lockout counts real client IPs rather than the proxy's.

For TLS without a proxy — enough for a plain `fetch`, still HTTP/1.1 and still six connections:

```bash
mkcert -install && mkcert localhost 127.0.0.1                 # a locally trusted certificate
SHELLM_TLS_CERT=./localhost+1.pem
SHELLM_TLS_KEY=./localhost+1-key.pem
```

Chrome needs one more thing for a public `https://` page to reach `127.0.0.1`: it sends a Private
Network Access preflight, and SheLLM answers it for allowed origins. No setting to turn on.

### Reading the numbers back

Every `/v1` response carries what a benchmark needs:

| | Where |
|---|---|
| `x-shellm-queue-ms`, `x-shellm-queue-position` | response headers (a stream reports its position before it starts) |
| `cost_usd`, `queue_ms`, `cli_ms`, `ttft_ms` | the `x_shellm` block in the body, the final stream chunk, or `message_delta` |
| token counts | `usage` — on a stream, send `stream_options: {"include_usage": true}` |

All of them are in `Access-Control-Expose-Headers`, so JavaScript can actually read them.

A request waiting for a free slot flushes its headers immediately and, while streaming, writes SSE
comment lines every few seconds:

```
: queued position=3 waiting_ms=6012
```

Once the request is running, the stream writes `: keepalive` comments until it ends, so a model
that thinks for minutes before its first token does not look like a dead connection to a proxy
such as Cloudflare, which drops one after 100 s of silence.

Every SSE parser ignores a comment line, so this needs no client change — it is there so you can
tell a queued request from a wedged one, and so intermediaries see traffic.

## 11. What not to do

- Do not put SheLLM behind a coding agent (Claude Code, Cline, Aider) — they drive their own CLI.
- Do not share a key outside your own applications. One subscription, one owner.
- Do not run batch or high-volume work through it. That is what paid API credit is for.
- Do not retry automatically on 429. That is how a subscription gets flagged.
