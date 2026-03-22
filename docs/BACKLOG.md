# Admin Dashboard — Aspirational Screens

Features and UI patterns shown in the Stitch-generated screens that do **not** have backend
support yet. Each section documents what the screen shows, what is missing from the codebase,
and what would need to be built to make it real.

Reference screens live in `docs/screens/`. When implementing a feature from this list,
move it to the active sprint and update the corresponding screen's `code.html` to use
real data instead of mock data.

---

## 1. Models Page — Provider Discovery & Setup

**Screen:** `docs/screens/models_shellm_admin_dashboard/`

### What the screen shows

- Provider cards for **Mistral AI** and **Ollama Local** in an "unconnected" state
- A **"Setup"** button on unconnected provider cards that presumably launches a configuration flow
- A **"Configure"** button on connected providers to edit settings
- A **Context Window** column in the Full Model Registry table (e.g., `200K`, `32K`)
- Provider IDs in `vendor/model-name` format (e.g., `anthropic/claude-3-opus-20240229`, `mistral/mistral-large-latest`)

### What exists today

| Feature | Status |
|---|---|
| claude, gemini, codex, cerebras provider cards | ✅ Real |
| Provider enabled/disabled toggle | ✅ Real |
| Auth status (authenticated / not installed) | ✅ Real |
| Model tags per provider | ✅ Real |
| Mistral AI provider | ❌ Not implemented |
| Ollama Local provider | ❌ Not implemented |
| "Setup" / "Configure" UI flow | ❌ Not implemented |
| Context window metadata per model | ❌ Not tracked in backend |
| `vendor/model-name` ID format | ❌ Current format is flat (e.g., `claude-sonnet`) |

### What needs to be built

1. **Mistral provider** (`src/providers/mistral.js`) — API-based, similar to Cerebras
2. **Ollama provider** (`src/providers/ollama.js`) — HTTP to local Ollama instance (`http://localhost:11434`)
3. **Provider configuration UI** — A form/modal to set provider-specific config (API key, base URL). Currently all config is via `.env`.
4. **Context window metadata** — Add `context_window` field to the provider contract and surface it in `GET /v1/models`
5. **Admin API endpoint** — `POST /admin/providers/:name/configure` to update provider settings without restarting

### Design reference

`docs/screens/models_shellm_admin_dashboard/code.html` — use as layout reference for
the cards grid + registry table. Strip Mistral/Ollama cards and "Setup" buttons until
those providers are implemented.

---

## 2. Overview — Real-Time Terminal Log Feed

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- A **live terminal feed** panel showing streaming log entries with timestamps, status codes, and request IDs
- Entries appear to animate in as new requests arrive (real-time push)
- `SYSTEM_STATUS: OK` footer in terminal style

### What exists today

| Feature | Status |
|---|---|
| Request log table (paginated, filterable) | ✅ Real — on the Logs page |
| `GET /admin/logs` API endpoint | ✅ Real |
| `SYSTEM_STATUS` footer line | ✅ Trivial — static text |
| Real-time log streaming (WebSocket / SSE) | ❌ Not implemented |
| Auto-updating log feed without page reload | ❌ Not implemented |

### What needs to be built

1. **SSE endpoint** — `GET /admin/logs/stream` that emits log entries as `text/event-stream`
2. **Alpine.js EventSource client** — in `overview.js`, open `EventSource('/admin/logs/stream')` and prepend entries to the feed
3. **Rate-limiting the stream** — Batch entries or throttle to avoid flooding the browser at high request rates

### Design reference

`docs/screens/shellm_admin_dashboard_overview/code.html` — the terminal feed panel at
the bottom of the screen. The `SYSTEM_STATUS: OK` footer is a one-liner that can be
added immediately as static text.

---

## 3. Overview — Quick Operations Panel

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- **"New Deployment"** button — unclear what this triggers in context
- **"Export Logs"** button — exports the request log as CSV or JSON

### What exists today

| Feature | Status |
|---|---|
| Export Logs | ❌ Not implemented |
| New Deployment | ❌ Unclear scope — likely out of scope for this service |

### What needs to be built

1. **Export Logs** — `GET /admin/logs/export?format=csv` endpoint that streams the full log table as CSV. High value, low effort.
2. **New Deployment** — Likely out of scope. SheLLM is not a deployment orchestrator. Remove this button from the implementation.

---

## 4. Overview — Security Alert Widget

**Screen:** `docs/screens/shellm_admin_dashboard_overview/`

### What the screen shows

- A highlighted alert card: "Security Alert — Unusual API key activity detected on key `sk-prod-...`"
- Implies anomaly detection on per-key usage patterns

### What exists today

| Feature | Status |
|---|---|
| Per-key request logging | ✅ Real |
| Admin brute-force lockout | ✅ Real |
| Anomaly detection / alerting | ❌ Not implemented |

### What needs to be built

1. **Usage anomaly heuristic** — Compare current RPM to historical average per key; flag if > 3x baseline
2. **Alert surface** — Store alerts in SQLite (`alerts` table), expose via `GET /admin/alerts`
3. **Dashboard widget** — Show the latest unacknowledged alert in the Overview with a dismiss button

### Notes

This is high-effort, medium-value for the current scale. Deprioritize until the service
has multiple active clients with meaningful traffic baselines.

---

## 5. CLI Auth Lifecycle — Session Monitoring, Alerts & Fallback

**Related:** Health checks (`src/health.js`), Router fail-fast (`src/router.js:75-103`)

### Problem Statement

CLI tools (`claude`, `gemini`, `codex`) manage their own auth sessions via local credential
files (`~/.claude/`, `~/.gemini/`, etc.). These sessions can expire silently, requiring
manual re-login. When this happens, SheLLM returns 503 errors until someone notices and
re-authenticates the CLI inside the container. There is no proactive detection, no alerting,
and no fallback.

### What exists today

| Feature | Status |
|---|---|
| Auth detection via stderr string matching | ✅ Fragile — regex for `"not authenticated"`, `"login"`, `"auth"` |
| Health cache (30s TTL) | ✅ Real — lazy, only checked on request |
| Fail-fast routing (skip unauthenticated providers) | ✅ Real — but no fallback, just 503 |
| Admin provider toggle (manual disable) | ✅ Real |
| Background health polling | ❌ Not implemented |
| Alerting on auth failure (webhook / email / Slack) | ❌ Not implemented |
| Automatic provider fallback | ❌ Not implemented |
| Circuit breaker pattern | ❌ Not implemented |
| Re-authentication mechanism | ❌ Not implemented (may not be possible for all CLIs) |

### Expert Panel Review

**SRE ("Reliability"):**
> Every failure must be observable and recoverable. The current lazy health check means
> auth expiration is only discovered when a user request fails — that's the worst time to
> learn. A background health poller (every 30-60s) with a state machine (healthy → degraded
> → down) would catch expiration before it impacts users. Structured logs with a
> `provider_auth_expired` event type are mandatory for any alerting pipeline. Circuit breaker
> per provider: after N consecutive auth failures, mark provider as `circuit_open` and stop
> sending traffic until the next health check passes.

**SecEng ("Security"):**
> CLI credential files in Docker volumes are a persistence risk. If the container is
> compromised, those credentials are exposed. Any alerting mechanism must NOT include
> credential details — only the fact that re-auth is needed. Webhook URLs for alerts
> should be stored as env vars, not in the database. Consider: can we validate CLI
> sessions without executing a full prompt? (`claude --version` may succeed even with
> expired session tokens — the health check might give false positives.)

**CLI ("LLM CLI Specialist"):**
> Each CLI has a different auth lifecycle. Claude Code uses OAuth with refresh tokens
> that can expire after inactivity. Gemini CLI uses Google Cloud auth which has its own
> token refresh. Codex uses OpenAI API keys which don't expire but can be revoked.
> A single "auth check" won't work for all — each provider needs a tailored auth
> validation command. Consider running a minimal prompt (`echo test | claude --print`)
> as the true auth check instead of `--version`. Also: CLI updates can change auth
> flows entirely — version-pin and test after every upgrade.

**Consumer ("Rails Integration"):**
> From Stockerly's perspective, a 503 with `provider_unavailable` is fine IF it includes
> enough info to decide: retry later? try a different model? give up? The response should
> include `available_providers` so the consumer can re-route. Ideal: the bridge itself
> handles fallback transparently. Acceptable: the bridge returns a structured error with
> alternatives so the consumer can retry with a different provider.

**Infra ("DevOps"):**
> Container restarts can invalidate CLI sessions stored in volumes if the volume isn't
> mounted correctly. Health check should run on container startup (not just lazily).
> Consider an init script that validates all CLI auth before the HTTP server starts
> accepting traffic — Kubernetes readiness probe style. Alerting via webhook to a
> monitoring endpoint (Uptime Kuma, Healthchecks.io) is the lowest-effort option.

### What needs to be built

#### Phase 1 — Proactive Detection (Medium effort, High value)

1. **Background health poller** — `setInterval` in `src/health.js` that checks all providers
   every 60s and emits structured log events (`provider_auth_ok`, `provider_auth_expired`,
   `provider_unreachable`)
2. **Deeper auth validation** — Replace `--version` checks with minimal prompt execution
   per provider (e.g., `echo test | claude --print`, `echo test | gemini`) to detect
   session-level auth failures, not just installation
3. **Startup health gate** — Run full health check before `server.listen()`. Log warnings
   for any unauthenticated providers. Optionally block startup if zero providers are healthy

#### Phase 2 — Alerting (Medium effort, High value)

4. **Webhook alerting** — `SHELLM_ALERT_WEBHOOK_URL` env var. POST a JSON payload when a
   provider transitions from healthy → unhealthy. Include: provider name, failure type,
   timestamp, action required. Supports Slack incoming webhooks, Discord, Uptime Kuma, etc.
5. **Admin dashboard alert banner** — Show a persistent warning in the admin UI when any
   provider is unauthenticated (already have the data from `/admin/providers`, just need
   the UI treatment)

#### Phase 3 — Resilience (High effort, High value)

6. **Provider fallback in router** — When the requested provider fails with auth error,
   automatically retry with the next available provider that supports the same model family.
   Return `X-SheLLM-Fallback-Provider` header so the consumer knows
7. **Circuit breaker per provider** — After 3 consecutive failures, open the circuit.
   Half-open after 60s (allow one probe request). Close on success. Expose circuit state
   via `/health` and `/admin/providers`
8. **Consumer error enrichment** — On 503 responses, include `available_providers` array
   and `suggested_model` so the consumer can self-route

#### Phase 4 — Stretch (High effort, Medium value)

9. **Auto re-authentication** — For providers with programmatic login (API key rotation,
   OAuth refresh), attempt re-auth automatically. Likely only feasible for Cerebras
   (env var reload) and possibly Gemini (gcloud token refresh). Claude and Codex may
   require manual intervention
10. **Metrics export** — Prometheus `/metrics` endpoint exposing `shellm_provider_auth_status`,
    `shellm_provider_circuit_state`, `shellm_health_check_duration_seconds`

### Notes

Phase 1-2 should be prioritized — they solve the "silent failure" problem with moderate
effort. Phase 3 is where the real reliability gains are but requires careful design of
the fallback model mapping. Phase 4 is nice-to-have and depends on upstream CLI capabilities.

---

## 6. SSE Streaming — Token-by-Token Responses via Server-Sent Events

**Related:** Provider base (`src/providers/base.js`), Chat completions (`src/v1/chat-completions.js`), Messages (`src/v1/messages.js`)

### Problem Statement

SheLLM currently buffers the entire CLI output before responding — even though the CLIs
emit tokens incrementally to stdout. This means a 30-second generation blocks the HTTP
response for 30 seconds. Consumers (Stockerly, future integrators) cannot show progressive
output to end users. Both the OpenAI and Anthropic APIs support `stream: true` with SSE
responses; SheLLM should too, for SDK compatibility and better UX.

### What exists today

| Feature | Status |
|---|---|
| `POST /v1/chat/completions` (full response) | ✅ Real |
| `POST /v1/messages` (full response) | ✅ Real — explicitly rejects `stream: true` |
| Subprocess stdout piped via `spawn` | ✅ Real — chunks arrive via `.on('data')` |
| Chunk buffering in `base.js` | ✅ Real — concatenates all chunks, resolves on exit |
| `stream: true` support on any endpoint | ❌ Not implemented |
| SSE response format (`text/event-stream`) | ❌ Not implemented |
| Streaming-aware provider interface | ❌ Not implemented |
| Streaming-aware queue/concurrency tracking | ❌ Not implemented |

### Provider Streaming Readiness

| Provider | Streaming Ready? | Detail |
|---|---|---|
| **Claude CLI** | ✅ Yes | `--print` already emits tokens to stdout incrementally. Node receives chunks via `.on('data')` but buffers them |
| **Codex CLI** | ✅ Yes | `--json` emits JSONL events line-by-line — inherently streamable. Most ready of all providers |
| **Cerebras API** | ✅ Yes | Standard OpenAI-compatible API — add `stream: true` to fetch body, parse SSE response chunks |
| **Gemini CLI** | ⚠️ Unclear | No obvious `--stream` flag in current invocation. Needs investigation — may require different flags or may not support incremental stdout |

### Expert Panel Review

**Contract ("API Design"):**
> This is not optional — it's a compatibility gap. Both OpenAI and Anthropic SDKs expect
> `stream: true` to return `text/event-stream` with `data: {chunk}` lines. Any consumer
> using `openai.chat.completions.create({ stream: true })` will get an error today. The
> response format must follow the exact SSE spec:
> - OpenAI format: `data: {"choices":[{"delta":{"content":"token"}}]}\n\n` per chunk,
>   `data: [DONE]\n\n` at end
> - Anthropic format: `event: content_block_delta\ndata: {"delta":{"text":"token"}}\n\n`
>   per chunk, `event: message_stop\n\n` at end
>
> Both formats are well-documented. Do NOT invent a custom streaming protocol.
> **Completeness note:** The spec should explicitly document how `usage` (token counts)
> and `cost_usd` are reported — typically in the final chunk only. Also specify behavior
> when `stream: true` is sent to a provider that doesn't support streaming (Gemini): return
> a clear 400 error, or buffer-and-flush as a single SSE event? I'd prefer the latter for
> consumer simplicity — the consumer shouldn't need to know which providers stream natively.

**Runtime ("Node.js Specialist"):**
> The infrastructure is already there — `spawn` with `stdio: 'pipe'` gives us a readable
> stream on `proc.stdout`. The refactor is straightforward:
> 1. `base.js` needs a `executeStream()` method that returns the `proc.stdout` readable
>    stream (or an async generator) instead of buffering
> 2. The endpoint handler sets `Content-Type: text/event-stream`, disables buffering
>    (`res.flushHeaders()`), and pipes chunks as `data:` lines
> 3. **Watch out for backpressure** — if the client reads slowly, Node's stream backpressure
>    will propagate to the CLI's stdout pipe, which could stall the CLI process. Use
>    `highWaterMark` tuning or an intermediate buffer if this becomes an issue.
>
> **Concern:** Error handling mid-stream. If the CLI crashes after emitting 50 tokens,
> you can't change the HTTP status (already sent 200). You must send an error event
> within the stream. Both OpenAI and Anthropic handle this — follow their convention.
>
> **Suggestion:** Use `pipeline()` from `stream/promises` for proper cleanup on client
> disconnect (avoids orphaned CLI processes when the consumer drops the connection).

**SRE ("Reliability"):**
> Streaming changes the failure model fundamentally:
> - **Timeout handling:** Current 120s timeout kills the process. With streaming, the
>   process may be alive and emitting but the client disconnected. Need to detect client
>   disconnect (`req.on('close')`) and kill the subprocess — otherwise orphaned processes
>   accumulate.
> - **Queue accounting:** Currently, a request occupies a queue slot from start to finish.
>   With streaming, the slot is held for the entire stream duration (potentially minutes).
>   Consider: should streaming requests bypass the queue? Have their own concurrency limit?
> - **Observability:** `duration_ms` in request logs becomes ambiguous — time to first
>   token (TTFT) vs total stream duration. Log both. TTFT is the metric consumers care
>   about; total duration is what capacity planning needs.
> - **Health endpoint impact:** A streaming response that hangs keeps the connection open
>   indefinitely. Add a `stream_timeout` (separate from request timeout) as a safety net.
>
> **Suggestion:** Add `X-Time-To-First-Token` response header for non-streaming requests
> too — useful baseline before streaming lands.

**CLI ("LLM CLI Specialist"):**
> Be very careful with what comes through stdout on CLI providers:
> - **Claude CLI with `--print`:** Streams tokens to stdout, but may also emit ANSI escape
>   codes, progress indicators, or warning messages depending on version. The `--output-format json`
>   flag should suppress this, but test empirically — I've seen CLIs inject deprecation
>   notices mid-stream.
> - **Codex CLI with `--json`:** JSONL events include `item.created`, `item.streaming`,
>   `item.completed`, `turn.completed`. The streaming-relevant event types need to be
>   mapped to SSE chunks. Not all JSONL lines contain content — filter carefully.
> - **Gemini CLI:** I would NOT block the entire feature on Gemini streaming. Ship streaming
>   for Claude + Codex + Cerebras first. For Gemini, use the buffer-and-flush approach
>   (single SSE event with full content). Revisit when Gemini CLI matures.
>
> **Risk:** CLI stdout may contain interleaved stderr on some platforms (especially when
> the CLI writes progress to stderr while streaming content to stdout). The current `spawn`
> setup separates them, but validate under load.

**Consumer ("Rails Integration"):**
> Stockerly doesn't need streaming today — we use synchronous Faraday calls. But this is
> table stakes for any future consumer that wants real-time UX (chat interfaces, VS Code
> extensions, web apps). The key ask: **if I send `stream: false` (or omit it), the
> behavior must remain identical to today.** Don't break the non-streaming path to add
> streaming.
>
> **Suggestion:** For the first iteration, just support streaming on `/v1/chat/completions`
> (OpenAI format). That's the one external consumers will use. `/v1/messages` can follow
> in a later phase.

**QA ("Testing Architect"):**
> Streaming is notoriously hard to test. Plan for:
> 1. **Unit tests for chunk formatting** — Given a raw stdout chunk, does it produce a valid
>    SSE `data:` line in the correct format (OpenAI or Anthropic)?
> 2. **Integration test with mock subprocess** — Spawn a script that emits tokens with
>    delays, verify SSE events arrive incrementally (not buffered)
> 3. **Client disconnect test** — Open stream, disconnect mid-response, verify subprocess
>    is killed and queue slot is released
> 4. **Error mid-stream test** — Process crashes after emitting tokens, verify error event
>    is sent in-stream
> 5. **Fallback test** — `stream: true` with Gemini (non-streaming provider), verify
>    buffer-and-flush behavior returns valid SSE
>
> **Do NOT** test streaming with `setTimeout` delays — use a deterministic mock that writes
> chunks on demand.

**Infra ("DevOps"):**
> Reverse proxy consideration: Traefik (used with Kamal) buffers responses by default.
> SSE requires disabling response buffering on the proxy:
> - Set `X-Accel-Buffering: no` response header (Nginx convention, Traefik respects it)
> - Or configure Traefik middleware to disable buffering for `/v1/*` routes
>
> Without this, the proxy will hold the entire SSE stream and deliver it all at once —
> defeating the purpose. This is a deployment-level gotcha that should be documented.
>
> **Docker consideration:** Streaming responses keep TCP connections open longer. Monitor
> file descriptor usage if concurrent streams increase. Default `ulimit -n` in the
> container may need tuning.

### What needs to be built

#### Phase 1 — Infrastructure (Medium effort, High value)

1. **`base.js` streaming mode** — Add `executeStream(cmd, args, opts)` that returns a
   `Readable` stream or async generator yielding stdout chunks as they arrive. Must handle:
   - Subprocess cleanup on stream abort (client disconnect)
   - Timeout as safety net (separate `STREAM_TIMEOUT_MS`, default 300s)
   - Error events when process exits non-zero mid-stream
2. **SSE response helper** — Utility to write properly formatted SSE lines:
   ```
   res.setHeader('Content-Type', 'text/event-stream')
   res.setHeader('Cache-Control', 'no-cache')
   res.setHeader('X-Accel-Buffering', 'no')
   res.flushHeaders()
   ```
   Plus functions: `writeSSEData(res, obj)`, `writeSSEDone(res)`, `writeSSEError(res, err)`

#### Phase 2 — OpenAI Streaming (Medium effort, High value)

3. **`POST /v1/chat/completions` with `stream: true`** — When `stream` is truthy:
   - Start SSE response immediately
   - Pipe provider chunks as `data: {"id":"...","choices":[{"delta":{"content":"token"}}]}\n\n`
   - End with `data: [DONE]\n\n`
   - Include `usage` in the final chunk (OpenAI convention)
   - For non-streaming providers (Gemini): buffer-and-flush as single SSE event
4. **Provider-specific chunk parsers:**
   - Claude: raw stdout text → content delta
   - Codex: JSONL line → filter `item.streaming` events → content delta
   - Cerebras: fetch with `stream: true` → re-emit SSE chunks
   - Gemini: full buffer → single content event

#### Phase 3 — Anthropic Streaming (Medium effort, Medium value)

5. **`POST /v1/messages` with `stream: true`** — Follow Anthropic SSE format:
   - `event: message_start`, `event: content_block_start`, `event: content_block_delta`,
     `event: content_block_stop`, `event: message_delta`, `event: message_stop`
   - More complex event structure than OpenAI — implement after OpenAI is proven

#### Phase 4 — Observability & Hardening (Low effort, Medium value)

6. **TTFT metric** — Log `time_to_first_token_ms` alongside `duration_ms` in request_logs
7. **Stream concurrency limit** — Separate `MAX_CONCURRENT_STREAMS` (default 2) to prevent
   long-lived streams from starving non-streaming requests
8. **Client disconnect cleanup** — `req.on('close')` kills subprocess, releases queue slot,
   logs `stream_aborted` event

### Risks & Open Questions

1. **Gemini streaming** — No known `--stream` flag. Buffer-and-flush is the safe default
   but should be revisited when Gemini CLI publishes streaming support
2. **Claude `--output-format json` + streaming** — Does JSON output mode suppress streaming?
   Need to test: does `claude --print --output-format json` emit incremental JSON or wait
   for the complete response? May need to drop `--output-format json` in streaming mode
   and parse raw text instead
3. **Proxy buffering** — Traefik/Nginx will defeat SSE unless explicitly configured.
   Must be documented in deployment guide and tested in staging
4. **Cost tracking** — Token counts and cost are currently calculated from the full response.
   In streaming mode, usage may only be available in the final CLI output or final JSONL
   event. Ensure cost logging still works

### Notes

Phase 1-2 are the high-value targets — they deliver OpenAI-compatible streaming for the
three providers that support it (Claude, Codex, Cerebras) with a graceful fallback for
Gemini. Phase 3 (Anthropic format) can follow once the infrastructure is proven. Phase 4
is operational hygiene that should land before streaming goes to production.

This feature has a direct dependency on the reverse proxy configuration (Traefik/Kamal).
Include proxy config changes in the implementation PR.

---

## 7. Mission Control Dashboard — Real-Time Observability

**Related:** Admin stats (`src/admin/stats.js`), Health (`src/health.js`), Logging (`src/middleware/logging.js`)

### Problem Statement

The admin dashboard is a static report — you refresh to see what happened. For a service
that bridges LLM requests in real time, operators need a Mission Control view: live request
flow, provider health at a glance, error rates trending, queue pressure, and cost burn.
Today, critical signals are buried in JSON logs or response headers that nobody reads.

### What exists today

| Feature | Status |
|---|---|
| Provider health cards (installed/authenticated) | ✅ Real |
| Metrics by period (24h/7d/30d) — total requests, tokens, cost | ✅ Real |
| Queue stats in response headers (`X-Queue-Depth`, `X-Queue-Active`) | ✅ Real — but invisible to operators |
| Request logs table (paginated) | ✅ Real |
| Error rate breakdown (4xx vs 5xx vs by type) | ❌ Not implemented |
| Per-provider latency percentiles (p50/p95/p99) | ❌ Not implemented |
| Live request feed | ❌ Not implemented (see backlog #2) |
| Cost burn rate / projection | ❌ Not implemented |
| Queue depth visualization | ❌ Not implemented |

### Expert Panel Review

**SRE ("Reliability"):**
> The minimum viable Mission Control needs four panels: (1) **Error rate over time** —
> not just totals, but a 5-minute rolling window so you see spikes as they happen.
> (2) **Provider status matrix** — green/yellow/red per provider with circuit state
> (healthy/degraded/open). (3) **Queue pressure gauge** — active/pending/max as a
> visual bar. (4) **TTFT by provider** — the single most important latency metric for
> LLM services. Without these, you're flying blind.
>
> The backend for most of this exists in `request_logs` — it's a dashboard query problem,
> not a data collection problem. The missing piece is the error rate breakdown: `/admin/stats`
> needs to return `status_counts: { 200: n, 429: n, 502: n, 503: n, 504: n }` alongside
> `total_requests`.

**Contract ("API Design"):**
> The `/admin/stats` endpoint should support a `group_by` parameter:
> `GET /admin/stats?period=24h&group_by=provider` or `&group_by=status` or
> `&group_by=client`. This avoids creating N specialized endpoints. The response shape
> stays consistent — just add a `breakdown` object alongside the existing totals.

**DevRel ("Developer Experience"):**
> A Mission Control screenshot in the README is worth 1000 words of documentation. If
> you build this, make it the hero image of the project. But it has to run on real data —
> a beautiful dashboard with zeros everywhere is worse than no dashboard. Consider shipping
> a `npm run seed:demo` that populates request_logs with realistic sample data so the
> dashboard looks alive out of the box.

**Infra ("DevOps"):**
> The dashboard should auto-refresh without SSE or WebSocket as a first step. A simple
> `setInterval(fetch, 5000)` in Alpine.js that hits `/admin/stats` every 5 seconds is
> 90% of the value with 10% of the complexity. SSE for the log feed (backlog #2) can
> come later. Don't over-engineer the real-time aspect — polling is fine at this scale.

### What needs to be built

#### Phase 1 — Backend Enrichment (Low effort, High value)

1. **Error rate breakdown in `/admin/stats`** — Add `status_counts` object to the stats
   response: `{ "2xx": n, "4xx": n, "5xx": n }` plus per-code detail `{ 200: n, 429: n,
   502: n, 503: n, 504: n }`. Query: `SELECT status, COUNT(*) FROM request_logs WHERE
   created_at > ? GROUP BY status`
2. **Cost breakdown** — Add `cost_by_provider` and `cost_by_client` to stats response.
   Query: `SELECT provider, SUM(cost_usd) FROM request_logs GROUP BY provider`
3. **Latency percentiles** — Add `latency_p50`, `latency_p95`, `latency_p99` to stats.
   SQLite doesn't have native percentile functions — use `ORDER BY duration_ms LIMIT 1
   OFFSET (COUNT * 0.95)` approximation or the `percentile` extension

#### Phase 2 — Dashboard Panels (Medium effort, High value)

4. **Error rate sparkline** — Small inline chart showing error rate over last 24h in
   15-minute buckets. Libraries: Chart.js (lightweight) or a simple SVG sparkline
5. **Queue pressure gauge** — Hit `/health` for queue stats, render as a segmented bar
   (active / pending / available capacity)
6. **Provider status matrix** — Color-coded grid: green (healthy + authenticated),
   yellow (healthy + circuit half-open), red (down/unauthenticated). Pull from
   `/admin/providers` + circuit breaker state (when implemented)
7. **Cost burn rate widget** — "Today: $4.20 | Projected monthly: $127" — simple
   extrapolation from last 24h spend

#### Phase 3 — Polish (Low effort, Medium value)

8. **Auto-refresh** — `setInterval` polling `/admin/stats` every 5s, update Alpine.js
   reactive data without full page reload
9. **`npm run seed:demo`** — Script that inserts 500-1000 realistic request_log entries
   with mixed providers, statuses, and costs over the last 7 days. Makes the dashboard
   look alive for demos and screenshots

---

## 8. Cost Intelligence — Per-Client Budgets & Spend Tracking

**Related:** Stats (`src/admin/stats.js`), Database (`src/db/index.js`), Auth (`src/middleware/auth.js`)

### Problem Statement

Cost tracking exists but is shallow: `cost_usd` per request, summed globally. Two providers
(Gemini, Codex) always return `null` for cost. There's no per-client or per-provider spend
visibility, no budget enforcement, and no alerting when spend is abnormal. For a fintech
consumer (Stockerly), uncontrolled LLM spend is a financial risk.

### What exists today

| Feature | Status |
|---|---|
| `cost_usd` column in `request_logs` | ✅ Real — populated by Claude and Cerebras |
| `total_cost_usd` in `/admin/stats` | ✅ Real — global sum only |
| Gemini / Codex cost tracking | ❌ Always `null` |
| Cost breakdown by client or provider | ❌ Not implemented |
| Per-client budget caps | ❌ Not implemented |
| Cost alerts / threshold warnings | ❌ Not implemented |
| Estimated cost for null-cost providers | ❌ Not implemented |

### Expert Panel Review

**Domain ("Fintech Advisor"):**
> This is non-negotiable for production use. Stockerly runs daily batch jobs across
> hundreds of portfolios — if someone deploys a prompt change that doubles token usage,
> we need to know within hours, not at the end of the month. Budget caps are a safety
> net, cost breakdowns are the diagnostic tool.
>
> **Pricing estimates for null-cost providers:** Gemini 2.5 Flash is ~$0.15/M input,
> $0.60/M output. Codex (GPT-4.1) is ~$2/M input, $8/M output. These are rough but
> better than null. Store them as configurable env vars (`SHELLM_COST_PER_1K_GEMINI_INPUT`,
> etc.) so they can be updated without code changes.

**SecEng ("Security"):**
> Budget caps are a security control, not just a finance feature. A compromised API key
> without a budget cap means unlimited spend. Enforce at the auth middleware layer —
> check cumulative spend before routing. The check must be fast: maintain a running
> total in memory (refreshed from DB every 60s), not a full DB query per request.
>
> **Do NOT** expose exact cost figures in error responses to the client. Return
> `"error": "budget_exceeded"` with no dollar amounts — the client shouldn't know
> the budget limit.

**Contract ("API Design"):**
> New error code needed: `budget_exceeded` (HTTP 429 — same family as rate limiting).
> Response shape: `{ "error": { "code": "budget_exceeded", "message": "Monthly budget
> exhausted for this client", "type": "rate_limit_error" } }`. Include `Retry-After`
> header with seconds until budget reset (start of next month).

**Consumer ("Rails Integration"):**
> From Stockerly's perspective, a `budget_exceeded` error is actionable — we can switch
> to a cheaper provider or queue the request for later. But we need to know it's a budget
> issue, not a rate limit or provider failure. Distinct error code is essential.

### What needs to be built

#### Phase 1 — Visibility (Low effort, High value)

1. **Cost breakdown queries** — Add to `/admin/stats` response:
   - `cost_by_provider: { claude: 85.20, cerebras: 3.10, gemini: null, codex: null }`
   - `cost_by_client: { "stockerly-prod": 72.50, "internal-tools": 15.80 }`
   - These are simple `GROUP BY` queries on the existing `request_logs` table
2. **Estimated costs for null providers** — Config via env vars:
   - `SHELLM_COST_ESTIMATE_GEMINI=0.0004` (per 1K tokens, blended input/output)
   - `SHELLM_COST_ESTIMATE_CODEX=0.005` (per 1K tokens, blended)
   - Apply estimate when provider returns `cost_usd: null` and `tokens > 0`

#### Phase 2 — Budget Enforcement (Medium effort, High value)

3. **`budget_usd` column in `clients` table** — `ALTER TABLE clients ADD COLUMN
   budget_usd REAL DEFAULT NULL` (null = unlimited)
4. **Budget check in auth middleware** — After authenticating the client, query
   `SELECT SUM(cost_usd) FROM request_logs WHERE client_name = ? AND created_at >=
   date('now', 'start of month')`. Cache result in memory (60s TTL). If over budget,
   return 429 `budget_exceeded`
5. **Admin API for budget management** — `PATCH /admin/keys/:id { budget_usd: 100 }`
   to set/update budgets
6. **Dashboard budget widget** — Per-client spend bar showing current vs budget with
   color coding (green < 70%, yellow 70-90%, red > 90%)

#### Phase 3 — Alerting (Medium effort, Medium value)

7. **Budget warning threshold** — When a client crosses 80% of budget, emit structured
   log event `budget_warning` and trigger webhook (reuse alerting from backlog #5)
8. **Cost anomaly detection** — If today's spend is > 3x the 7-day daily average,
   emit `cost_anomaly` event. Simple heuristic, no ML needed

---

## 9. Client Lifecycle — Expiration, Metadata & Audit

**Related:** Keys admin (`src/admin/keys.js`), Database (`src/db/index.js`), Auth middleware (`src/middleware/auth.js`)

### Problem Statement

API keys never expire, carry no metadata beyond a name, and admin actions (create, rotate,
delete) are not audited. For a service handling LLM traffic, stale keys and untracked
admin actions are operational and security risks.

### What exists today

| Feature | Status |
|---|---|
| Client CRUD (create, toggle, rotate, delete) | ✅ Real |
| SHA-256 hashed key storage | ✅ Real |
| Per-client RPM rate limit | ✅ Real |
| Per-client model restrictions | ✅ Real |
| Key expiration / TTL | ❌ Not implemented |
| Client metadata (description, owner, tags) | ❌ Not implemented |
| Admin action audit log | ❌ Not implemented |
| Bulk import/export of clients | ❌ Not implemented |

### Expert Panel Review

**SecEng ("Security"):**
> Key expiration is the single highest-value security improvement on this list. Non-expiring
> keys accumulate risk — a forgotten key from a test environment becomes a permanent
> attack surface. Implementation is trivial: add `expires_at TEXT` column, check in auth
> middleware, return 401 `key_expired` when past expiration. Default should be 90 days
> with admin override.
>
> **Audit logging** is equally important. Every key operation (create, rotate, delete,
> toggle, budget change) should insert a row into an `admin_audit_log` table with
> `action`, `target`, `actor_ip`, `timestamp`. This is compliance 101.

**OSS ("Open Source Maintainer"):**
> Client metadata matters more than you think. When you have 10 keys and something goes
> wrong, you need to know: whose key is this? What team? What service? A `description`
> field and `owner` field save frantic Slack messages at 2am.

**Contract ("API Design"):**
> New error code: `key_expired` (HTTP 401). The response should include `expired_at`
> timestamp so the consumer can report "this key expired 3 days ago" rather than
> "authentication failed" with no context.

### What needs to be built

#### Phase 1 — Key Expiration (Low effort, High value)

1. **Schema change** — `ALTER TABLE clients ADD COLUMN expires_at TEXT DEFAULT NULL`
   (null = never expires)
2. **Auth middleware check** — After validating the key hash, check
   `if (client.expires_at && new Date(client.expires_at) < new Date())` → return 401
   `key_expired` with `expired_at` in the response body
3. **Admin API** — `PATCH /admin/keys/:id { expires_at: "2026-06-01" }` and expose in
   `GET /admin/keys` response
4. **Dashboard indicator** — Show expiration date on key cards. Highlight keys expiring
   within 7 days in yellow, expired keys in red

#### Phase 2 — Metadata & Audit (Low effort, Medium value)

5. **Client metadata columns** — `description TEXT`, `owner TEXT`, `tags TEXT` (JSON array)
6. **Admin audit log table** — `CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY,
   action TEXT, target TEXT, detail TEXT, actor_ip TEXT, created_at TEXT DEFAULT
   (datetime('now')))`. Insert on every admin mutation
7. **Audit log endpoint** — `GET /admin/audit?limit=50&action=key_rotated` with pagination
   and filtering
8. **Dashboard audit tab** — Timeline view of admin actions

---

## 10. Smart Routing — Cost-Aware & Latency-Aware Provider Selection

**Related:** Router (`src/router.js`), Provider registry (`src/providers/`)

### Problem Statement

The router is a simple lookup: the consumer requests a model name, the router maps it to
a provider. There's no intelligence — no fallback when a provider fails, no cost
optimization, no latency awareness. Consumers must make all routing decisions themselves.

### What exists today

| Feature | Status |
|---|---|
| Model-to-provider mapping via aliases | ✅ Real — `SHELLM_ALIASES` env var |
| Direct provider selection by model name | ✅ Real |
| Fail-fast on unauthenticated provider | ✅ Real |
| Fallback to alternative provider | ❌ Not implemented (see backlog #5) |
| Cost-aware routing (`auto-cheap`) | ❌ Not implemented |
| Latency-aware routing | ❌ Not implemented |
| Request priority / queue bypass | ❌ Not implemented |

### Expert Panel Review

**Domain ("Fintech Advisor"):**
> Cost-aware routing is the killer feature for Stockerly. Our batch jobs process hundreds
> of portfolios daily — they don't need Claude Opus. A virtual model `auto-cheap` that
> routes to the cheapest healthy provider (Cerebras → Gemini → Codex → Claude) would save
> 80%+ on batch costs without any changes to the Rails caller. The consumer just sends
> `model: "auto-cheap"` and the bridge figures it out.
>
> Similarly, `auto-best` for high-value analysis (earnings calls, risk assessments) would
> prefer Claude, falling back to Codex if Claude is down.

**SRE ("Reliability"):**
> Latency-aware routing requires tracking p50 per provider over a rolling window. Don't
> over-engineer this — a simple exponential moving average (EMA) of `duration_ms` per
> provider is sufficient. Update on every response. Route `auto-fast` to the provider
> with the lowest EMA.
>
> **Request priority** is high value: if Stockerly's real-time endpoint needs a response
> NOW, it shouldn't wait behind 10 queued batch requests. A `X-Priority: high` header
> that pushes to the front of the queue (not bypasses — still respects concurrency limit)
> solves this cleanly.

**Consumer ("Rails Integration"):**
> Virtual models (`auto-cheap`, `auto-fast`, `auto-best`) are the ideal interface. The
> Rails caller doesn't need to know provider names or health status — it just declares
> intent. The bridge returns which provider actually handled it in the response headers
> (`X-SheLLM-Provider: cerebras`) so we can log it on our side.

**Contract ("API Design"):**
> Virtual models should appear in `GET /v1/models` alongside real models, with a `type:
> "virtual"` flag. The `owned_by` field should be `shellm` (not a provider). This way
> the consumer discovers them the same way they discover real models.

### What needs to be built

#### Phase 1 — Virtual Models (Medium effort, High value)

1. **`auto-cheap` routing** — Define a cost ranking per provider (configurable via env var
   `SHELLM_COST_RANKING=cerebras,gemini,codex,claude`). Route to the first healthy provider
   in the list. Return `X-SheLLM-Provider` and `X-SheLLM-Route-Reason: cost` headers
2. **`auto-best` routing** — Inverse ranking (Claude → Codex → Gemini → Cerebras). For
   high-value requests where quality matters more than cost
3. **Virtual models in `/v1/models`** — Include `auto-cheap`, `auto-best` (and later
   `auto-fast`) in the model list with `owned_by: "shellm"`, `type: "virtual"`

#### Phase 2 — Latency-Aware (Medium effort, Medium value)

4. **Provider latency tracker** — Exponential moving average of `duration_ms` per provider,
   updated on every response. Stored in memory (not DB)
5. **`auto-fast` routing** — Route to the provider with the lowest latency EMA. Useful
   for real-time, user-facing requests

#### Phase 3 — Priority Queue (Medium effort, Medium value)

6. **Request priority** — Parse `X-Priority: high|normal|low` header. High-priority
   requests are inserted at the front of the queue (LIFO within priority). Default: `normal`
7. **Per-client default priority** — `priority` column in `clients` table. Stockerly's
   real-time key gets `high`, batch key gets `low`

---

## 11. API Parameter Passthrough — temperature, response_format, stop

**Related:** Chat completions (`src/v1/chat-completions.js`), Messages (`src/v1/messages.js`), Providers (`src/providers/`)

### Problem Statement

Consumers can't control generation parameters (temperature, top_p, stop sequences) or
request structured output (JSON mode). These are standard parameters in both the OpenAI
and Anthropic APIs that SheLLM silently ignores today.

### What exists today

| Feature | Status |
|---|---|
| `temperature` parameter | ❌ Ignored — not passed to providers |
| `top_p` parameter | ❌ Ignored |
| `stop` sequences | ❌ Ignored |
| `response_format: { type: "json_object" }` | ❌ Ignored — providers report `supports_json_output` but it's never used |

### Expert Panel Review

**Contract ("API Design"):**
> `temperature` is the most-requested missing parameter. Every LLM cookbook starts with
> "set temperature to 0 for deterministic output." If SheLLM ignores it, the consumer has
> no control over response variability. The fix is straightforward: accept the parameter
> in the request body, pass it as a CLI flag or API parameter to the provider.
>
> `response_format` is a close second — JSON mode is critical for structured data
> extraction (Stockerly's primary use case). The providers already declare
> `supports_json_output` in their capability flags; the router should check this and
> pass the appropriate flag to the CLI.

**CLI ("LLM CLI Specialist"):**
> CLI flag availability per provider:
> - **Claude:** `--temperature 0.5` ✅ supported. JSON mode via system prompt instruction
>   (no dedicated flag, but `--output-format json` affects CLI output, not model output)
> - **Gemini:** `-t 0.5` or `--temperature 0.5` — check CLI help. JSON mode likely via
>   system prompt
> - **Codex:** Temperature not obviously exposed in `codex exec` flags. May need to pass
>   via the prompt or a config option
> - **Cerebras:** Standard API parameters — `temperature`, `top_p`, `stop`, `response_format`
>   all supported in the request body
>
> **Risk:** Not all providers support all parameters equally. Define behavior when a
> parameter is unsupported: silently ignore (current), or return 400? I'd prefer: pass
> when supported, silently ignore when not, and document the support matrix.

**QA ("Testing Architect"):**
> Test matrix needed: for each parameter × each provider, verify the parameter is either
> passed correctly or gracefully ignored. This is a combinatorial surface — keep tests
> focused: one test per provider that verifies the CLI args include `--temperature` when
> the request specifies it.

### What needs to be built

#### Phase 1 — temperature (Low effort, High value)

1. **Accept `temperature` in request body** — Both `/v1/chat/completions` and `/v1/messages`
2. **Pass to providers:**
   - Claude: add `--temperature ${temp}` to args
   - Gemini: add `--temperature ${temp}` to args (verify flag name)
   - Codex: investigate flag availability; skip if unsupported
   - Cerebras: add `temperature` to fetch body (already JSON)
3. **Validation** — `0 <= temperature <= 2` (OpenAI range). Return 400 if out of range

#### Phase 2 — response_format (Medium effort, High value)

4. **Accept `response_format` in request body** — `{ type: "json_object" }` or
   `{ type: "text" }` (default)
5. **Provider implementation:**
   - Claude: prepend system prompt instruction "Respond with valid JSON only" (no CLI flag)
   - Cerebras: add `response_format` to fetch body
   - Gemini/Codex: system prompt instruction fallback
6. **Validation** — Only accept `json_object` on providers that declare `supports_json_output`
   or use system prompt fallback

#### Phase 3 — stop sequences & top_p (Low effort, Low value)

7. **`stop` parameter** — Pass to providers that support it (Cerebras API, possibly Claude CLI
   via `--stop-sequences`). Silently ignore for others
8. **`top_p` parameter** — Same pattern as temperature

---

## 12. Developer Experience — Linting, Seeding & Migrations

**Related:** Package.json scripts, CONTRIBUTING.md, Database (`src/db/index.js`)

### Problem Statement

The DX foundation is solid (213 tests, setup-dev.sh, check-env.js) but has gaps that
create friction for contributors: no linter means style discussions in PRs, no seed data
means the dashboard looks empty on first run, and database schema changes require manual
SQL because there's no migration system.

### What exists today

| Feature | Status |
|---|---|
| `npm test` — 213 tests, < 1s runtime | ✅ Real |
| `npm run dev` — watch mode with auto-restart | ✅ Real |
| `setup-dev.sh` — interactive onboarding | ✅ Real |
| `check-env.js` — pre-flight validation | ✅ Real |
| ESLint / Prettier | ❌ Not configured |
| Pre-commit hook auto-installation | ❌ `scripts/pre-commit` exists but not linked |
| Seed data for development | ❌ Not implemented |
| Database migrations | ❌ Schema hardcoded in `initDb()` |
| Architecture diagram | ❌ Not documented |

### Expert Panel Review

**QA ("Testing Architect"):**
> ESLint is the highest-ROI DX investment. It catches bugs (unused vars, missing awaits,
> accidental globals) that tests don't. Configuration: `eslint:recommended` +
> `plugin:node/recommended`. Do NOT add Prettier in the same PR — it'll touch every file
> and pollute git blame. Add Prettier separately with a single format commit.

**DevRel ("Developer Experience"):**
> `npm run seed` is essential for two audiences: (1) new contributors who want to see the
> dashboard with data, and (2) demo/screenshot preparation. The seed should create 3-5
> clients with realistic names and 500+ request_log entries spanning 7 days with mixed
> providers, statuses, and latencies.
>
> **Architecture diagram:** A simple Mermaid diagram in the README showing
> `Consumer → Auth → Queue → Router → Provider → CLI → LLM` is 10 minutes of work and
> answers the "how does this work?" question that every new contributor has.

**Release ("Release Engineer"):**
> Database migrations are not urgent at this scale (4 tables, < 100 lines of schema) but
> will become critical the moment you need to add a column in production without dropping
> the DB. A simple numbered migration system (files like `001_initial.sql`, `002_add_budget.sql`)
> with a `migrations` tracking table is sufficient. No need for Knex or TypeORM — raw SQL
> files executed in order.

**OSS ("Open Source Maintainer"):**
> Pre-commit hooks should be auto-installed via `npm run prepare` (using the `prepare`
> lifecycle script in package.json). This ensures every contributor gets hooks on
> `npm install` without remembering to run a separate setup step.

### What needs to be built

#### Phase 1 — Immediate Wins (Low effort, High value)

1. **ESLint setup** — `npm install -D eslint @eslint/js`. Config: `eslint.config.js` with
   `recommended` rules + Node.js globals. Add `npm run lint` script. Fix initial violations.
   Add to CI
2. **Pre-commit hook auto-install** — Add `"prepare": "cp scripts/pre-commit .git/hooks/
   && chmod +x .git/hooks/pre-commit"` to package.json. Hook runs `npm run lint && npm test`
3. **Architecture diagram** — Mermaid diagram in README:
   ```
   Consumer → [Auth MW] → [Rate Limit] → [Queue] → [Router] → [Provider] → [CLI/API] → LLM
   ```

#### Phase 2 — Seed & Migrations (Medium effort, Medium value)

4. **`npm run seed`** — Script (`scripts/seed.js`) that:
   - Creates 4 demo clients (stockerly-prod, stockerly-staging, internal-tools, demo-key)
   - Inserts 1000 request_log entries over 7 days with realistic distribution:
     85% success, 5% timeout, 5% rate_limited, 5% cli_failed
   - Mixed providers (40% claude, 25% cerebras, 20% gemini, 15% codex)
   - Realistic latencies (500ms-30s depending on provider)
   - Cost values for claude/cerebras, null for gemini/codex
5. **Simple SQL migrations** — `migrations/` directory with numbered `.sql` files.
   `migrations_log` table tracks which have run. Migration runner in `src/db/index.js`:
   on startup, scan `migrations/`, execute any not yet applied, record in log.
   No external dependencies needed — just `fs.readdirSync` + `db.exec()`

#### Phase 3 — Polish (Low effort, Low value)

6. **Prettier** — Add after ESLint is stable. Single format-all commit to establish baseline.
   Configure to match existing style (single quotes, no semicolons, or whatever the codebase
   already uses). Add to pre-commit hook
7. **`npm run check:all`** — Meta-script that runs `lint + test + check:env` in sequence.
   Single command for contributors to validate before pushing

---

## 13. Security Hardening — Key Expiry Enforcement & Input Validation

**Related:** Auth middleware (`src/middleware/auth.js`), Admin auth (`src/middleware/admin-auth.js`)

### Problem Statement

API keys never expire, request body size limits are global and fixed, there's no IP
allowlisting, and the secret redaction in health check errors is fragile. These are
low-effort, high-impact security improvements that reduce the attack surface.

### What exists today

| Feature | Status |
|---|---|
| SHA-256 hashed key storage | ✅ Real |
| Admin brute-force lockout (5 attempts / 5 min) | ✅ Real |
| Timing-safe password comparison | ✅ Real |
| Request body size limit (256KB global) | ✅ Real — not configurable |
| Secret redaction in health errors | ✅ Fragile — regex `[A-Za-z0-9_-]{32,}` only |
| Key expiration | ❌ Not implemented |
| IP allowlisting | ❌ Not implemented |
| `npm audit` in CI | ❌ Not configured |
| Configurable body size per client | ❌ Not implemented |

### Expert Panel Review

**SecEng ("Security"):**
> Priority order for this section:
> 1. **Key expiration** — Highest ROI. One column, one check. Non-expiring keys are a
>    compliance red flag in any regulated industry (fintech).
> 2. **`npm audit` in CI** — Trivial to add, catches supply chain issues automatically.
>    Add `npm audit --audit-level=high` to the CI pipeline.
> 3. **Improved secret redaction** — The current regex misses short API keys, keys with
>    special characters, and known patterns (sk-..., gsk_..., AIza...). Add pattern-specific
>    matchers for known key formats.
> 4. **IP allowlisting** — Medium effort but high value for production. A client with
>    `allowed_ips: ["10.0.0.0/8"]` ensures that even a leaked key can't be used from
>    outside the network.

**Infra ("DevOps"):**
> IP allowlisting needs to account for reverse proxies. The real client IP is in
> `X-Forwarded-For`, not `req.ip`. Express 5 has `app.set('trust proxy', ...)` for this.
> Get it wrong and you're checking the proxy's IP, not the client's.

### What needs to be built

#### Phase 1 — Quick Wins (Low effort, High value)

1. **Key expiration** — Covered in detail in backlog #9. Just the schema + middleware check
2. **`npm audit` in CI** — Add `npm audit --audit-level=high` step to CI pipeline. Fails
   build if high/critical vulnerabilities found
3. **Improved secret redaction** — Add known API key patterns to the redaction function
   in `src/health.js`:
   - `sk-[a-zA-Z0-9]+` (OpenAI)
   - `AIza[a-zA-Z0-9_-]+` (Google)
   - `gsk_[a-zA-Z0-9]+` (Groq/Cerebras)
   - Existing catch-all for 32+ char alphanumeric strings

#### Phase 2 — Access Control (Medium effort, Medium value)

4. **IP allowlisting** — `allowed_ips TEXT` column in `clients` table (JSON array of CIDR
   ranges). Check in auth middleware after key validation. `null` = allow all.
   Use `node:net` `isIPv4` and a simple CIDR matcher (no dependencies needed for /8, /16,
   /24 masks)
5. **Configurable body size per client** — `max_body_kb INTEGER` column in `clients` table.
   Override the global 256KB limit. Useful for clients sending large prompts

---

## Priority Order

| Feature | Effort | Value | Recommended | Backlog # |
|---|---|---|---|---|
| **Immediate / Next Sprint** | | | | |
| Export Logs CSV | Low | High | ✅ Next sprint | #3 |
| Ollama provider | Medium | High | ✅ Next sprint | #1 |
| Background health poller + deeper auth checks | Medium | High | ✅ Next sprint | #5 |
| Webhook alerting (Slack/Discord/Uptime Kuma) | Medium | High | ✅ Next sprint | #5 |
| Error rate breakdown in `/admin/stats` | Low | High | ✅ Next sprint | #7 |
| Cost breakdown by client + provider | Low | High | ✅ Next sprint | #8 |
| Key expiration (`expires_at`) | Low | High | ✅ Next sprint | #9 |
| `npm audit` in CI | Trivial | High | ✅ Next sprint | #13 |
| ESLint setup + CI integration | Low | High | ✅ Next sprint | #12 |
| `temperature` passthrough to providers | Low | High | ✅ Next sprint | #11 |
| Startup health gate | Low | Medium | ✅ Next sprint | #5 |
| Admin dashboard auth alert banner | Low | Medium | ✅ Next sprint | #5 |
| Pre-commit hook auto-install | Trivial | Medium | ✅ Next sprint | #12 |
| Architecture diagram (Mermaid in README) | Trivial | Medium | ✅ Next sprint | #12 |
| Improved secret redaction patterns | Low | Medium | ✅ Next sprint | #13 |
| `SYSTEM_STATUS` footer (static) | Trivial | Low | ✅ Implement now | #2 |
| **Soon — Next After Sprint** | | | | |
| SSE streaming — `base.js` + SSE helper | Medium | High | 🟡 Next after sprint | #6 |
| SSE streaming — `/v1/chat/completions` | Medium | High | 🟡 Next after sprint | #6 |
| Budget caps per client (`budget_usd`) | Medium | High | 🟡 Next after sprint | #8 |
| `auto-cheap` / `auto-best` virtual models | Medium | High | 🟡 Next after sprint | #10 |
| `response_format` (JSON mode) passthrough | Medium | High | 🟡 Next after sprint | #11 |
| `npm run seed` (demo data) | Medium | Medium | 🟡 Next after sprint | #12 |
| **Backlog** | | | | |
| Provider fallback in router | High | High | 🟡 Backlog | #5 |
| Circuit breaker per provider | High | High | 🟡 Backlog | #5 |
| Mission Control dashboard panels (sparklines, gauges) | Medium | High | 🟡 Backlog | #7 |
| SSE streaming — `/v1/messages` stream | Medium | Medium | 🟡 Backlog | #6 |
| SSE streaming — TTFT metric + stream concurrency | Low | Medium | 🟡 Backlog | #6 |
| Consumer error enrichment (available_providers) | Medium | Medium | 🟡 Backlog | #5 |
| `auto-fast` latency-aware routing | Medium | Medium | 🟡 Backlog | #10 |
| Request priority queue (`X-Priority`) | Medium | Medium | 🟡 Backlog | #10 |
| Client metadata (description, owner, tags) | Low | Medium | 🟡 Backlog | #9 |
| Admin action audit log | Medium | Medium | 🟡 Backlog | #9 |
| Budget warning + cost anomaly alerts | Medium | Medium | 🟡 Backlog | #8 |
| Simple SQL migrations system | Medium | Medium | 🟡 Backlog | #12 |
| IP allowlisting per client | Medium | Medium | 🟡 Backlog | #13 |
| `stop` / `top_p` passthrough | Low | Low | 🟡 Backlog | #11 |
| Context window metadata | Low | Medium | 🟡 Backlog | #1 |
| Mistral provider | Medium | Medium | 🟡 Backlog | #1 |
| Real-time admin log stream (SSE) | High | Medium | 🟡 Backlog | #2 |
| Provider configuration UI | High | Medium | 🟡 Backlog | #1 |
| Cost burn rate + projected monthly widget | Low | Medium | 🟡 Backlog | #7 |
| Dashboard auto-refresh (polling) | Low | Medium | 🟡 Backlog | #7 |
| Prettier setup | Low | Low | 🟡 Backlog | #12 |
| `npm run check:all` meta-script | Trivial | Low | 🟡 Backlog | #12 |
| **Deprioritize** | | | | |
| Auto re-authentication | High | Medium | 🔴 Deprioritize | #5 |
| Prometheus metrics export | High | Medium | 🔴 Deprioritize | #5 |
| Security alert widget (anomaly detection) | High | Low | 🔴 Deprioritize | #4 |
| Configurable body size per client | Low | Low | 🔴 Deprioritize | #13 |
| **Out of Scope** | | | | |
| New Deployment button | — | — | ❌ Remove | #3 |
