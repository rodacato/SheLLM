# SheLLM — Roadmap

> Last updated: 2026-02-27

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in implementation phases plus a future enhancements backlog.

---

## Phases 1–10 — Summary `COMPLETED`

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
| **9 — SQLite + Key Mgmt** | SQLite persistence, admin key CRUD, request logging | `src/db/`, `src/admin/keys.js`, `src/middleware/admin-auth.js`, 138 tests |
| **10 — Admin Dashboard** | Browser dashboard, logs/stats endpoints, SPA | `src/admin/public/`, `src/admin/logs.js`, `src/admin/stats.js`, 156 tests |

**Key architectural decisions (phases 1–6, 9):**
- CommonJS, three runtime dependencies (Express + dotenv + better-sqlite3), functional provider modules
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

## Phase 9 — SQLite + Key Management API `COMPLETED`

SQLite persistence via `better-sqlite3` for client key management and request logging. Keys can be created, rotated, and revoked at runtime without restarting the service.

**9a — Database Layer:** Singleton `src/db/index.js` with WAL mode, two tables (`clients` + `request_logs`), SHA-256 key hashing, `shellm-<32hex>` key format, auto-prune (30 days), DB at `~/.shellm/shellm.db` (mode 600). Tests use `:memory:`.

**9b — Key Management API:** `src/admin/keys.js` Express Router — `GET/POST/PATCH/DELETE /admin/keys`, `POST /admin/keys/:id/rotate`. Admin auth via `SHELLM_ADMIN_PASSWORD` (HTTP Basic). Raw key only visible on create and rotate. `src/middleware/admin-auth.js` with timing-safe password comparison.

**9c — Request Logging + Auth:** `/v1/*` requests logged to `request_logs` (request_id, client, provider, model, status, duration_ms, queued_ms, tokens, cost_usd). `src/middleware/auth.js` updated with DB-first client lookup, env var fallback. `src/v1/chat-completions.js` exposes `queued_ms`, `cost_usd`, `usage` on `res.locals`.

---

## Phase 10 — Admin Dashboard `COMPLETED`

Browser-based admin dashboard at `/admin/dashboard/`. Static HTML SPA served by Express — Tailwind CSS 4 (CDN) + Alpine.js (CDN), no build step, no frontend `node_modules`.

**10a — Backend endpoints:** `GET /admin/logs` (paginated, filterable by provider/client/status/date), `GET /admin/stats` (aggregated metrics by period: 24h/7d/30d), `GET /admin/models` (proxy for dashboard, avoids Bearer auth).

**10b — Dashboard pages:** Overview (provider health cards, queue stats, request metrics by period), Request Logs (filterable table with pagination, status badges, duration/token/cost columns), API Keys (full CRUD — create modal, active toggle, rotate, delete), Models (provider cards with health dots + model list table).

**10c — Architecture:** SPA shell `src/admin/public/index.html` with sidebar navigation. Alpine.js components per page (`js/overview.js`, `js/logs.js`, `js/keys.js`, `js/models.js`). Auth via browser's native HTTP Basic dialog (triggered by `WWW-Authenticate` header from `admin-auth.js`).

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
