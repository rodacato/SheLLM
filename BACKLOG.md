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

## Priority Order

| Feature | Effort | Value | Recommended |
|---|---|---|---|
| Export Logs CSV | Low | High | ✅ Next sprint |
| Ollama provider | Medium | High | ✅ Next sprint |
| Background health poller + deeper auth checks | Medium | High | ✅ Next sprint |
| Webhook alerting (Slack/Discord/Uptime Kuma) | Medium | High | ✅ Next sprint |
| Startup health gate | Low | Medium | ✅ Next sprint |
| Admin dashboard auth alert banner | Low | Medium | ✅ Next sprint |
| `SYSTEM_STATUS` footer (static) | Trivial | Low | ✅ Implement now (cosmetic) |
| Provider fallback in router | High | High | 🟡 Backlog |
| Circuit breaker per provider | High | High | 🟡 Backlog |
| Consumer error enrichment (available_providers) | Medium | Medium | 🟡 Backlog |
| Context window metadata | Low | Medium | 🟡 Backlog |
| Mistral provider | Medium | Medium | 🟡 Backlog |
| Real-time log stream (SSE) | High | Medium | 🟡 Backlog |
| Provider configuration UI | High | Medium | 🟡 Backlog |
| Auto re-authentication | High | Medium | 🔴 Deprioritize |
| Prometheus metrics export | High | Medium | 🔴 Deprioritize |
| Security alert widget | High | Low | 🔴 Deprioritize |
| New Deployment button | — | — | ❌ Out of scope — remove |
