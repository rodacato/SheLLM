# SheLLM — Roadmap

> Last updated: 2026-02-27

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in implementation phases plus a future enhancements backlog.

---

## Phases 1–8 — Summary `COMPLETED`

| Phase | Scope | Key Deliverables |
|---|---|---|
| **1 — Core Service** | Express server, providers, queue, middleware | `src/server.js`, `src/router.js`, `src/providers/`, `src/middleware/`, `src/health.js` |
| **2 — API Contract & Auth** | Multi-client auth, rate limiting, error standardization | `src/errors.js`, `src/middleware/auth.js`, pre-commit hook, `.env.example` |
| **3 — Testing** | 56 tests across 16 suites, < 1s runtime | `test/` (unit + integration via `node:test` + `supertest`) |
| **4 — Containerization** | Dockerfile, compose (dev use) | `Dockerfile`, `docker-compose.yml`, `.dockerignore` |
| **5 — CLI & Logging** | `shellm` CLI, structured JSON logger, log rotation | `src/cli.js`, `src/cli/*.js`, `src/lib/logger.js`, `config/logrotate.conf` |
| **6 — VPS Deployment** | systemd, cloudflared, provisioning script | `shellm.service`, `scripts/setup-vps.sh` |
| **7 — API Hardening** | Validation, graceful shutdown, observability | 82 tests, settled guard, buffer cap, queue headers |
| **8 — OpenAI Proxy** | `/v1/chat/completions`, `/v1/models`, model aliases | Replaced legacy `/completions` + `/providers`, 93 tests |

**Key architectural decisions (phases 1–6):**
- CommonJS, two runtime dependencies (Express + dotenv), functional provider modules
- Queue: max 2 concurrent, max 10 depth, in-memory; 120s subprocess timeout, 1MB buffer cap
- Multi-client bearer tokens via `SHELLM_CLIENTS` JSON env var; auth disabled when unset
- Direct VPS deployment (not containerized) — CLI OAuth tokens persist in `~shellmer/`
- cloudflared tunnel to `shellm.notdefined.dev` — zero open ports, Cloudflare handles TLS

---

## Phase 7 — API Hardening `COMPLETED`

Correctness, safety, and reliability gaps fixed. No new dependencies. 82 tests (26 new), all passing.

**7a — Correctness:** `max_tokens` validation (1–128000), `system` type check, prompt length cap (50k), Content-Type enforcement, 256kb body limit, double-rejection guard in base.js.

**7b — Reliability:** Graceful shutdown (SIGTERM/SIGINT, 30s drain), fail-fast on unauthenticated provider, 1MB subprocess buffer cap, SIGTERM→SIGKILL (5s grace), Retry-After header on 429.

**7c — Observability:** `queued_ms` in responses, `duration_ms` in errors, `X-Queue-Depth`/`X-Queue-Active` headers, provider/model in logs, queue depth logging, token redaction in health stderr.

**7d — Tests:** base.js (timeout, buffer, spawn error, env), validate (prompt length, system, max_tokens), server integration (Content-Type, body limit, queue headers), health cache, router fail-fast.

---

## Phase 8 — OpenAI-Compatible Proxy `COMPLETED`

Drop-in replacement for any OpenAI SDK, LangChain, Continue.dev, or Cursor. Legacy `/completions` and `/providers` endpoints removed.

**8a — `/v1/chat/completions`:** Accepts `messages[]` array, translates to `prompt` + `system` for all providers. Returns OpenAI shape (`choices`, `usage`, `id: "shellm-..."`). Multi-turn conversation support. OpenAI error format `{ error: { message, type, code, param } }`. Inline validation (model, messages, max_tokens, prompt length).

**8b — `/v1/models`:** OpenAI model list format (`object: "list"`, `data[]` with `id`, `object: "model"`, `owned_by: "shellm"`). Includes all provider models plus user-defined aliases.

**8c — Model Aliases:** `SHELLM_ALIASES` env var (JSON `{"gpt-4":"claude","fast":"cerebras-8b"}`). Aliases resolve through existing `modelToProvider` map, visible in `/v1/models`.

**Removed:** `POST /completions`, `GET /providers`, `src/middleware/validate.js`. Kept: `GET /health`.

---

## Phase 9 — SQLite + Key Management API `PENDING`

Migrate client auth from `SHELLM_CLIENTS` env var to SQLite. Keys can be created, rotated, and revoked without restarting the service. Foundation for request logging, metrics, and the admin dashboard.

**Expert rationale:**
- **SRE:** SQLite is the prerequisite for logs, metrics, and dashboard — without persistence, none of those features work.
- **SecEng:** Env var keys require restart to rotate — unacceptable in production. SQLite file with mode 600 on VPS is secure and auditable.
- **Runtime:** `better-sqlite3` is synchronous but at <100 req/day, blocking is negligible. Adds one native dependency.
- **QA:** Tests use `:memory:` SQLite — no file cleanup, fast, deterministic.

### 9a — Database Layer

| Task | Status | Files |
|---|---|---|
| Add `better-sqlite3` dependency | Pending | `package.json` |
| Database module (init, migrations, connection) | Pending | `src/db/index.js` |
| `clients` table (id, name, key_hash, rpm, models, active, created_at) | Pending | `src/db/index.js` |
| `request_logs` table (id, request_id, client_id, provider, model, status, duration_ms, tokens, cost_usd, created_at) | Pending | `src/db/index.js` |
| DB file at `~/.shellm/shellm.db` (mode 600) | Pending | `src/db/index.js` |
| Backwards-compatible: fall back to `SHELLM_CLIENTS` env var if DB is empty | Pending | `src/middleware/auth.js` |
| Unit tests (`:memory:` DB) | Pending | `test/db/` |

### 9b — Key Management REST API

| Task | Status | Files |
|---|---|---|
| `GET /admin/keys` — list all keys (masked) | Pending | `src/admin/keys.js` |
| `POST /admin/keys` — create key (name, rpm, models) | Pending | `src/admin/keys.js` |
| `PATCH /admin/keys/:id` — update rpm, models, active | Pending | `src/admin/keys.js` |
| `DELETE /admin/keys/:id` — revoke key | Pending | `src/admin/keys.js` |
| `POST /admin/keys/:id/rotate` — generate new secret | Pending | `src/admin/keys.js` |
| Admin auth middleware (admin password via env var) | Pending | `src/middleware/admin-auth.js` |
| Unit tests | Pending | `test/admin/keys.test.js` |

**Admin auth:** Single admin account via `SHELLM_ADMIN_PASSWORD` env var. All `/admin/*` routes require `Authorization: Basic admin:<password>`. Simple, no DB overhead for user management.

### 9c — Request Logging to DB

| Task | Status | Files |
|---|---|---|
| Log every request to `request_logs` table | Pending | `src/middleware/logging.js`, `src/db/index.js` |
| Fields: request_id, client, provider, model, status, duration_ms, queued_ms, tokens, error | Pending | `src/db/index.js` |
| Auto-prune logs older than 30 days (on startup + daily) | Pending | `src/db/index.js` |
| Unit tests | Pending | `test/db/` |

---

## Phase 10 — Admin Dashboard `PENDING`

Static HTML dashboard served by Express. **Tailwind CSS 4** (CDN) for styling, **Alpine.js** (CDN) for reactivity — no build step, no `node_modules` frontend deps. Consumes the `/admin/*` and `/health` APIs.

**Tech stack:**
- **Tailwind CSS 4** via CDN (`<script src="https://cdn.tailwindcss.com">`) — utility-first, responsive, clean design out of the box
- **Alpine.js** via CDN (`<script src="https://cdn.jsdelivr.net/npm/alpinejs">`) — 15KB, declarative `x-data`/`x-for`/`x-show` for tables, filters, modals. Modern jQuery replacement, no build step
- **Express `static()`** serves the files — no template engine, no SSR

**Expert rationale:**
- **Contract:** Dashboard is a view layer, not a new API. All data comes from existing endpoints.
- **SecEng:** Same admin auth as Phase 9 (`SHELLM_ADMIN_PASSWORD`). Dashboard behind `/admin/` prefix. Tailwind/Alpine via CDN = no supply chain risk in `node_modules`.
- **Runtime:** Zero server-side rendering. Express serves static files. Alpine.js `fetch()` calls consume the REST API.

**Data storage (runtime, outside repo):**
```
~/.shellm/
├── shellm.db          # SQLite (clients, request_logs)
├── shellm.pid         # PID file (daemon mode)
└── logs/
    └── shellm.log     # Daemon log file (logrotate)
```

### 10a — Dashboard Pages

| Page | Content | API Source |
|---|---|---|
| **Overview** | Health status, queue stats, uptime, provider status cards | `GET /health`, `GET /admin/stats` |
| **Request Logs** | Sortable table: time, status (badge), request_id, client, provider, model, duration, cost. Search by request_id, filter by status/provider/date range, pagination | `GET /admin/logs` |
| **API Keys** | Table: alias, key (masked), rpm, allowed models, active toggle, created_at. Create modal, revoke/rotate actions | `GET/POST/PATCH/DELETE /admin/keys` |
| **Models** | Provider cards with: name, models, capabilities, health status (green/red dot) | `GET /providers`, `GET /health` |

### 10b — File Structure

```
src/admin/public/
├── index.html          # SPA shell: sidebar nav, Tailwind CDN, Alpine.js CDN
├── css/
│   └── custom.css      # Minimal overrides (if any — Tailwind handles most)
└── js/
    ├── app.js          # Alpine.js global store (auth, navigation, shared state)
    ├── overview.js     # Overview page component
    ├── logs.js         # Request Logs page component
    ├── keys.js         # API Keys page component
    └── models.js       # Models page component
```

### 10c — Tasks

| Task | Status | Files |
|---|---|---|
| HTML shell with sidebar nav (Tailwind + Alpine.js) | Pending | `src/admin/public/index.html` |
| Alpine.js global store (auth, fetch wrapper, navigation) | Pending | `src/admin/public/js/app.js` |
| Overview page (health cards, queue stats, uptime) | Pending | `src/admin/public/js/overview.js` |
| Request Logs page (table, search, filters, pagination) | Pending | `src/admin/public/js/logs.js` |
| API Keys page (CRUD table with create modal) | Pending | `src/admin/public/js/keys.js` |
| Models page (provider cards with health dots) | Pending | `src/admin/public/js/models.js` |
| `GET /admin/logs` endpoint (paginated, filterable) | Pending | `src/admin/logs.js` |
| `GET /admin/stats` endpoint (aggregated metrics from DB) | Pending | `src/admin/stats.js` |
| Serve static files at `/admin/` behind admin auth | Pending | `src/server.js` |
| Unit tests for admin API endpoints | Pending | `test/admin/` |

---

## Phase 11 — Additional Endpoints `PENDING`

Expand API compatibility with Anthropic Messages format and embeddings.

### 11a — `/v1/messages` (Anthropic Format)

High value because Claude Code and the Anthropic SDK speak this format natively. Pure translation layer — no new provider logic.

| Task | Status | Files |
|---|---|---|
| `POST /v1/messages` endpoint | Pending | `src/v1/messages.js` |
| Translate Anthropic request → internal format | Pending | `src/v1/messages.js` |
| Return Anthropic response shape (`content[]`, `stop_reason`, `usage`) | Pending | `src/v1/messages.js` |
| Unit tests | Pending | `test/v1/messages.test.js` |

### 11b — `/v1/embeddings`

Requires direct API access — CLIs don't expose embedding functionality. Needs at least one embedding-capable API provider.

| Task | Status | Files |
|---|---|---|
| Embedding provider interface | Pending | `src/providers/embeddings/` |
| OpenAI embeddings provider (API key) | Pending | `src/providers/embeddings/openai.js` |
| `POST /v1/embeddings` endpoint | Pending | `src/v1/embeddings.js` |
| Unit tests | Pending | `test/v1/embeddings.test.js` |

**Note:** This is the first feature that cannot be served by CLI backends. It requires a direct API key (OpenAI, Cohere, or Vertex AI). Lower priority unless a consumer specifically needs it.

---

## Future Enhancements `BACKLOG`

| Feature | Description | Effort | Priority |
|---|---|---|---|
| Streaming support | `POST /v1/chat/completions` with `stream: true` (SSE) | Medium | Medium |
| Webhook callbacks | `POST /tasks` → async, POST result to `callback_url` | Medium | Medium |
| Provider fallback | If primary fails, auto-retry with alternate provider | Low | Low |
| Per-client model restrictions | Optional `models` array in client config | Low | Low |
| Response caching | In-memory LRU cache with per-request opt-out | Low | Low |
| Scheduled tasks | Cron-like recurring completions (via node-cron or external) | Medium | Low |
| Token usage tracking | Estimate token consumption per provider | Low | Low |

---

## Decision Log

| Decision | Resolution | Rationale |
|---|---|---|
| Runtime language | Node.js (Express) | CLIs are npm packages — same runtime, no extra dependency |
| CLI vs API approach | CLI subprocess | Subscriptions provide CLI access, not API keys |
| Module system | CommonJS | No build step, consistent with Express ecosystem |
| Provider pattern | Functional modules | No classes — simpler, no `this` binding issues |
| Max concurrent | 2 | Prevents CPU contention on shared VPS |
| Timeout | 120s | CLI cold start + LLM generation can be slow |
| Auth persistence | Native home dir (`~shellmer/`) | Docker volumes broke on rebuilds; native FS survives CLI updates and deploys |
| Port binding | 127.0.0.1 only | Internal service, not internet-facing |
| Queue implementation | In-memory array | Low volume (< 100 req/day), no Redis needed |
| Response format | Unified JSON | Caller doesn't care which provider answered |
| Authentication | Multi-client bearer tokens → SQLite (Phase 9) | Env var keys require restart to rotate; DB allows runtime management |
| Error handling | Factory functions + `fromCatchable()` bridge | Centralized error creation; no classes |
| Test framework | Node.js built-in `node:test` | Zero external test dependencies; built-in mocking |
| Deployment model | Direct on VPS (not containerized) | CLI OAuth tokens break on container rebuilds |
| Network access | cloudflared tunnel (`shellm.notdefined.dev`) | Zero open ports, Cloudflare handles TLS |
| Database | SQLite via `better-sqlite3` (Phase 9) | No PostgreSQL needed for <100 req/day; single file, zero ops, backup = cp |
| Dashboard | Static HTML + vanilla JS (Phase 10) | No React/Vue/build step; Express serves static files; no frontend dependencies |
| Admin auth | Single admin via `SHELLM_ADMIN_PASSWORD` env var | Simple, no DB user table needed; one admin is sufficient for self-hosted |
| OpenAI compatibility | `/v1/chat/completions` + `/v1/models` (Phase 8) | De facto standard; enables any OpenAI SDK client to use SheLLM |
| License | MIT | Open source, permissive, standard for Node.js ecosystem |
