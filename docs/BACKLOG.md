# Product Backlog

Features and UI patterns that do **not** have backend support yet, plus completed items
kept as summary records. Each active section documents what exists, what is missing, and
what would need to be built. Completed items are collapsed to a one-paragraph summary.

Reference screens live in `docs/screens/`. When implementing a feature from this list,
move it to the active sprint and update the corresponding screen's `code.html` to use
real data instead of mock data.

---

## Quick Reference

| # | Feature | Summary | Status |
|---|---|---|---|
| 1 | [Models Page](#1-models-page--provider-discovery--setup) | Provider cards for Mistral/Ollama, setup flow, context window metadata, vendor/model ID format | 🟡 Backlog |
| 2 | [Real-Time Terminal Log Feed](#2-overview--real-time-terminal-log-feed) | Live streaming log feed on Overview page via SSE | 🟡 Backlog |
| 3 | [Quick Operations Panel](#3-overview--quick-operations-panel) | Export logs CSV, quick actions from Overview | ✅ Done |
| 4 | [Security Alert Widget](#4-overview--security-alert-widget) | Anomaly detection and security alerts on Overview | 🔴 Deprioritized |
| 5 | [CLI Auth Lifecycle](#5-cli-auth-lifecycle--session-monitoring-alerts--fallback) | Auth session monitoring, expiry alerts, provider fallback, circuit breaker | ✅ Done |
| 6 | [SSE Streaming](#6-sse-streaming--token-by-token-responses-via-server-sent-events) | Token-by-token streaming for `/v1/chat/completions` and `/v1/messages` | ✅ Done |
| 7 | [Mission Control Dashboard](#7-mission-control-dashboard--real-time-observability) | Sparklines, error rate breakdown, cost burn rate, auto-refresh on Overview | ✅ Done |
| 8 | [Cost Intelligence](#8-cost-intelligence--per-client-budgets--spend-tracking) | Per-client cost breakdown, budget caps, spend alerts | 🟡 Backlog |
| 9 | [Client Lifecycle](#9-client-lifecycle--expiration-metadata--audit) | Key expiration, client metadata, admin audit log | ✅ Done |
| 10 | [Smart Routing](#10-smart-routing--cost-aware--latency-aware-provider-selection) | Virtual models (`auto-cheap`, `auto-best`), latency-aware routing, priority queue | 🟡 Backlog |
| 11 | [API Parameter Passthrough](#11-api-parameter-passthrough--temperature-response_format-stop) | `temperature`, `response_format`, `top_p` forwarded to providers | ✅ Done |
| 12 | [Developer Experience](#12-developer-experience--linting-seeding--migrations) | ESLint, seed data, migrations, pre-commit hooks | ✅ Done |
| 13 | [Security Hardening](#13-security-hardening--key-expiry-enforcement--input-validation) | Key expiry enforcement, input validation, secret redaction | ✅ Done |
| 14 | [Admin Playground](#14-admin-playground--interactive-api-testing-console) | Interactive console to test prompts, switch providers/models, see raw responses | ✅ Done |

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

## 3. Overview — Quick Operations Panel — ✅ Done

Implemented in `feat(admin): add CSV log export`. Export endpoint at `GET /admin/logs/export` with CSV format, formula injection protection, and query param filtering. Frontend button on Logs page.

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

## 5. CLI Auth Lifecycle — Session Monitoring, Alerts & Fallback — ✅ Done

Background health poller (deep checks at startup, shallow `--version` recurring every 5min). Startup health gate with provider warnings. Webhook alerting on health transitions (`SHELLM_ALERT_WEBHOOK_URL`). Provider fallback with `X-SheLLM-Fallback-Provider` header. Per-provider circuit breaker (closed/open/half_open). Consumer error enrichment with `available_providers` in 503 responses. Degraded health status in `/health`. Gemini keychain fallback handling. Pattern-specific secret redaction.

---

## 6. SSE Streaming — Token-by-Token Responses via Server-Sent Events — ✅ Done

`executeStream` async generator in `base.js` with abort/timeout support. SSE helpers (`initSSE`, `sendSSEChunk`, `sendSSEDone`, `sendSSEError`). OpenAI streaming on `/v1/chat/completions` and Anthropic streaming on `/v1/messages` with proper event sequences. Provider `chatStream` for Claude (raw stdout), Codex (JSONL parsing), Cerebras (SSE re-emit). Gemini buffer-and-flush fallback in both formats. TTFT metric in stream events. `MAX_STREAM_CONCURRENT` limit. Client disconnect detection via socket polling. Debug breadcrumb logs for stream lifecycle.

---

## 7. Mission Control Dashboard — Real-Time Observability — ✅ Done

Stats grid (requests, tokens, cost, avg duration), requests-by-provider and cost-by-provider bar charts, error rate breakdown (2xx/4xx/5xx percentage bars). Chart.js sparklines for request volume, errors, and cost trend with timeline data (hourly buckets for 24h, daily for 7d/30d). Cost burn rate ($/hr). Auto-refresh every 30s when overview page is visible. Provider health cards with toggle. Queue stats widget.

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

## 9. Client Lifecycle — Expiration, Metadata & Audit — ✅ Done

Key expiration (`expires_at` column) with auth middleware enforcement and admin UI (color-coded: red expired, yellow expiring soon). Client `description` field via migration 003. Admin audit log table (`admin_audit_logs`) logging create/update/delete/rotate actions with `GET /admin/audit` endpoint and collapsible Activity Log panel on the keys page.

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

## 11. API Parameter Passthrough — temperature, response_format, stop — ✅ Done

Implemented `temperature` (0-2), `response_format` (`{type:'json_object'}` / `{type:'text'}`), and `top_p` (0-1) passthrough to all providers. Cerebras passes all natively via API body. Claude uses `--temperature` CLI flag and system prompt augmentation for JSON mode. Gemini uses `-t` flag and system prompt fallback. Codex uses system prompt fallback. `stop` sequences deprioritized (complex across CLI providers, low value).

---

## 12. Developer Experience — Linting, Seeding & Migrations — ✅ Done

ESLint 9 with flat config (semi, single quotes, no-var, prefer-const, eqeqeq). Pre-commit hook auto-installed via `npm run prepare` (sets `core.hooksPath` to `scripts/`), runs lint + secret scanning. `npm run seed` creates demo clients and 30 request log entries. File-based SQL migration system in `migrations/` with `_migrations` tracking table — runs automatically on `initDb()`. Mermaid architecture diagram in README. Prettier skipped (ESLint covers style).

---

## 13. Security Hardening — Key Expiry Enforcement & Input Validation — ✅ Done

Key expiration (`expires_at` column with auth middleware enforcement), `npm audit` in CI pipeline, and improved secret redaction (pattern-specific matchers for `sk-*`, `csk-*`, `shellm-*`, `Bearer` tokens, plus 32+ char catch-all). IP allowlisting and configurable body size deprioritized (service is loopback-only behind cloudflared).

---

## 14. Admin Playground — Interactive API Testing Console — ✅ Done

Implemented in `feat(admin): add Playground page`. Alpine.js SPA page with provider/model selectors, system/user prompt, stream on/off toggle, real-time SSE streaming with cursor animation, response panel (status/latency/request_id/tokens), copy-as-curl, cancel/stop button, live elapsed timer, and API key input.

---

## Priority Order

| Feature | Effort | Value | Recommended | Backlog # |
|---|---|---|---|---|
| **Immediate / Next Sprint** | | | | |
| Export Logs CSV | Low | High | ✅ Done | #3 |
| Ollama provider | Medium | High | ✅ Next sprint | #1 |
| Background health poller + deeper auth checks | Medium | High | ✅ Done | #5 |
| Webhook alerting (Slack/Discord/Uptime Kuma) | Medium | High | ✅ Done | #5 |
| Error rate breakdown in `/admin/stats` | Low | High | ✅ Done | #7 |
| Cost breakdown by client + provider | Low | High | ✅ Next sprint | #8 |
| Key expiration (`expires_at`) | Low | High | ✅ Done | #9 |
| `npm audit` in CI | Trivial | High | ✅ Done | #13 |
| ESLint setup + CI integration | Low | High | ✅ Done | #12 |
| `temperature` passthrough to providers | Low | High | ✅ Done | #11 |
| Startup health gate | Low | Medium | ✅ Done | #5 |
| Admin dashboard auth alert banner | Low | Medium | ✅ Done | #5 |
| Pre-commit hook auto-install | Trivial | Medium | ✅ Done | #12 |
| Architecture diagram (Mermaid in README) | Trivial | Medium | ✅ Next sprint | #12 |
| Improved secret redaction patterns | Low | Medium | ✅ Done | #13 |
| `SYSTEM_STATUS` footer (static) | Trivial | Low | ✅ Implement now | #2 |
| **Soon — Next After Sprint** | | | | |
| SSE streaming — `base.js` + SSE helper | Medium | High | ✅ Done | #6 |
| SSE streaming — `/v1/chat/completions` | Medium | High | ✅ Done | #6 |
| Budget caps per client (`budget_usd`) | Medium | High | 🟡 Next after sprint | #8 |
| `auto-cheap` / `auto-best` virtual models | Medium | High | 🟡 Next after sprint | #10 |
| `response_format` (JSON mode) passthrough | Medium | High | ✅ Done | #11 |
| `npm run seed` (demo data) | Medium | Medium | ✅ Done | #12 |
| **Backlog** | | | | |
| Provider fallback in router | High | High | ✅ Done | #5 |
| Circuit breaker per provider | High | High | ✅ Done | #5 |
| Mission Control dashboard panels (sparklines, gauges) | Medium | High | 🟡 Backlog | #7 |
| SSE streaming — `/v1/messages` stream | Medium | Medium | ✅ Done | #6 |
| SSE streaming — TTFT metric + stream concurrency | Low | Medium | ✅ Done | #6 |
| Consumer error enrichment (available_providers) | Medium | Medium | ✅ Done | #5 |
| `auto-fast` latency-aware routing | Medium | Medium | 🟡 Backlog | #10 |
| Request priority queue (`X-Priority`) | Medium | Medium | 🟡 Backlog | #10 |
| Client metadata (description, owner, tags) | Low | Medium | 🟡 Backlog | #9 |
| Admin action audit log | Medium | Medium | 🟡 Backlog | #9 |
| Budget warning + cost anomaly alerts | Medium | Medium | 🟡 Backlog | #8 |
| Simple SQL migrations system | Medium | Medium | 🟡 Backlog | #12 |
| IP allowlisting per client | Medium | Medium | 🔴 Deprioritize | #13 |
| `stop` sequences passthrough | Low | Low | 🔴 Deprioritize | #11 |
| Admin Playground — core page + selectors + response panel | Medium | High | ✅ Done | #14 |
| Context window metadata | Low | Medium | 🟡 Backlog | #1 |
| Mistral provider | Medium | Medium | 🟡 Backlog | #1 |
| Real-time admin log stream (SSE) | High | Medium | 🟡 Backlog | #2 |
| Playground — Copy as curl | Low | Medium | ✅ Done | #14 |
| Playground — Request ID link to Logs | Low | Medium | 🟡 Backlog | #14 |
| Provider configuration UI | High | Medium | 🟡 Backlog | #1 |
| Cost burn rate + projected monthly widget | Low | Medium | 🟡 Backlog | #7 |
| Dashboard auto-refresh (polling) | Low | Medium | 🟡 Backlog | #7 |
| Playground — Prompt presets + response diff | Low | Low | 🟡 Backlog | #14 |
| Prettier setup | Low | Low | 🟡 Backlog | #12 |
| `npm run check:all` meta-script | Trivial | Low | 🟡 Backlog | #12 |
| **Deprioritize** | | | | |
| Auto re-authentication | High | Medium | 🔴 Deprioritize | #5 |
| Prometheus metrics export | High | Medium | 🔴 Deprioritize | #5 |
| Security alert widget (anomaly detection) | High | Low | 🔴 Deprioritize | #4 |
| Configurable body size per client | Low | Low | 🔴 Deprioritize | #13 |
| **Out of Scope** | | | | |
| New Deployment button | — | — | ❌ Remove | #3 |
