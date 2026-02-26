# SheLLM — Roadmap

> Last updated: 2026-02-26

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in five implementation phases plus a future enhancements backlog.

---

## Phase 1 — Core Service `COMPLETED`

The Express server, provider wrappers, request queue, middleware, and health check endpoint.

| Task | Status | Files |
|---|---|---|
| Initialize Node.js project with Express | Done | `package.json`, `src/server.js` |
| Base subprocess runner with timeout | Done | `src/providers/base.js` |
| Claude CLI provider | Done | `src/providers/claude.js` |
| Gemini CLI provider | Done | `src/providers/gemini.js` |
| Codex CLI provider | Done | `src/providers/codex.js` |
| Cerebras API provider | Done | `src/providers/cerebras.js` |
| Request router with queue | Done | `src/router.js` |
| Validation and sanitization middleware | Done | `src/middleware/` |
| Health check endpoint | Done | `src/health.js` |

**Key decisions made:**
- CommonJS throughout (no ESM, no transpilation)
- Single dependency (Express) — everything else is Node.js built-ins
- Functional provider modules (no classes, no inheritance)
- Queue: max 2 concurrent, max 10 depth, in-memory
- Timeout: 120s per subprocess, configurable via `TIMEOUT_MS`

---

## Phase 2 — API Contract & Authentication `COMPLETED`

Formalized API specification, multi-client authentication, rate limiting, and error standardization.

| Task | Status | Files |
|---|---|---|
| Error factory module | Done | `src/errors.js` |
| Multi-client bearer token authentication | Done | `src/middleware/auth.js` |
| Global + per-client rate limiting (sliding window RPM) | Done | `src/middleware/auth.js` |
| Request ID propagation (header / body / auto-UUID) | Done | `src/middleware/request-id.js` |
| Standardized error responses across all failure modes | Done | `src/errors.js`, `src/server.js` |
| Structured JSON logging with request_id and client | Done | `src/middleware/logging.js` |
| Health check TTL cache (30s default) | Done | `src/health.js` |
| Pre-commit hook to block secrets | Done | `scripts/pre-commit` |
| Environment variable template | Done | `.env.example` |
| API contract documented in README | Done | `README.md` |

**Key decisions made:**
- Multi-client auth via `SHELLM_CLIENTS` JSON env var (GitHub Secrets in CI, `.env` locally)
- Auth disabled when env var unset (zero-friction development)
- Timing-safe token comparison (`crypto.timingSafeEqual`)
- Rate limiting: global RPM + per-client RPM, sliding window, in-memory
- Error factories (not classes) with `fromCatchable()` bridge for old error shapes
- Health cache: 30s TTL for provider status, queue/uptime always fresh
- dotenv for `.env` file loading

---

## Phase 3 — Testing `COMPLETED`

Comprehensive test suite validating the API contract, provider wrappers, middleware, and error handling. No real CLI calls or network requests in tests.

| Task | Status | Files |
|---|---|---|
| Error factory unit tests | Done | `test/errors.test.js` |
| Sanitization unit tests | Done | `test/middleware/sanitize.test.js` |
| Request ID middleware tests | Done | `test/middleware/request-id.test.js` |
| Validation middleware tests | Done | `test/middleware/validate.test.js` |
| Auth middleware tests (disabled/valid/invalid) | Done | `test/middleware/auth.test.js` |
| Claude provider tests (buildArgs/parseOutput/chat) | Done | `test/providers/claude.test.js` |
| Gemini provider tests | Done | `test/providers/gemini.test.js` |
| Codex provider tests (JSONL parsing) | Done | `test/providers/codex.test.js` |
| Cerebras provider tests (mocked fetch) | Done | `test/providers/cerebras.test.js` |
| Router tests (resolve/list/queue) | Done | `test/router.test.js` |
| Health check tests (status + cache) | Done | `test/health.test.js` |
| Server integration tests (supertest) | Done | `test/server.test.js` |

**Key decisions made:**
- Node.js built-in test runner (`node:test`) + `supertest` devDependency
- `mock.module()` with `--experimental-test-module-mocks` for CLI provider `chat()` tests (solves CommonJS destructured-import mocking)
- `mock.method(global, 'fetch')` for Cerebras API tests
- Pure function tests (buildArgs, parseOutput, sanitize, errors) need zero mocking
- 33 test cases across 12 suites, < 1s total runtime

---

## Phase 4 — Containerization `PLANNED`

Production-ready Docker setup with CLI installations and auth management scripts.

| Task | Status | Files |
|---|---|---|
| Production Dockerfile with CLI installations | Pending | `Dockerfile` |
| Production docker-compose.yml | Pending | `docker-compose.yml` |
| Auth setup script (interactive) | Pending | `scripts/setup-auth.sh` |
| Auth check script (verification) | Pending | `scripts/check-auth.sh` |

**Notes:**
- Dev container (`.devcontainer/`) already exists and works — this phase is for the production image
- Production image: `node:22-slim` + Claude Code + Gemini CLI + Codex CLI
- Auth tokens persist via Docker volumes (`~/.claude/`, `~/.config/gemini/`, `~/.codex/`)
- Port binding: `127.0.0.1:6000` (loopback only)
- Resource limits: 768MB RAM, 1.0 CPU

---

## Phase 5 — Deployment `PLANNED`

CI/CD pipeline and production deployment via Kamal.

| Task | Status | Files |
|---|---|---|
| Build and push Docker image to GHCR | Pending | `.github/workflows/` |
| Add Kamal accessory config to Stockerly | Pending | `config/deploy.yml` (in Stockerly repo) |
| First-time auth setup on VPS | Pending | Manual (documented in README) |

**Deployment target:**
- GHCR (GitHub Container Registry) for image hosting
- Kamal accessory pattern (same as PostgreSQL in Stockerly)
- Single VPS, Docker Compose in production
- Consumed by Stockerly via `http://127.0.0.1:6000` or Docker network

---

## Future Enhancements (v2) `BACKLOG`

Features to consider after the core service is stable in production.

| Feature | Description | Effort | Priority |
|---|---|---|---|
| Streaming support | `POST /completions/stream` with SSE | Medium | High |
| Provider fallback | If primary fails, auto-retry with another provider | Low | High |
| Response caching | Cache identical prompts for N minutes (in-memory) | Low | Medium |
| Token usage tracking | Log estimated token consumption per provider | Low | Medium |
| Prompt templates | Named templates with variable substitution | Low | Low |
| Conversation history | Multi-turn with session persistence | Medium | Low |
| Web UI dashboard | Simple stats page (requests/day, latency, errors) | Medium | Low |
| Webhook callback | Async: accept request, POST result to callback URL | Medium | Low |

---

## Decision Log

Architectural decisions made during implementation, with rationale.

| Decision | Resolution | Rationale |
|---|---|---|
| Runtime language | Node.js (Express) | CLIs are npm packages — same runtime, no extra dependency |
| CLI vs API approach | CLI subprocess | Subscriptions provide CLI access, not API keys |
| Module system | CommonJS | No build step, consistent with Express ecosystem |
| Provider pattern | Functional modules | No classes — simpler, no `this` binding issues |
| Max concurrent | 2 | Prevents CPU contention on shared VPS |
| Timeout | 120s | CLI cold start + LLM generation can be slow |
| Auth persistence | Docker volumes | Survives container restarts and redeploys |
| Port binding | 127.0.0.1 only | Internal service, not internet-facing |
| Queue implementation | In-memory array | Low volume (< 100 req/day), no Redis needed |
| System prompt handling | `--system-prompt` for Claude, prepend for others | Avoids wasted tokens on CLI agentic scaffolding |
| Response format | Unified JSON | Caller doesn't care which provider answered |
| Phase order | API contract → Testing → Containerization | Tests validate contract; containerize a stable, tested service |
| Authentication | Multi-client bearer tokens via env var | Supports multiple consumers with individual rate limits; disabled in dev |
| Rate limiting | Global + per-client RPM (sliding window) | Protects VPS from overload while giving each client a fair share |
| Client config | `SHELLM_CLIENTS` JSON env var | Public-repo safe (GitHub Secrets); no file-based config to leak |
| Error handling | Factory functions + `fromCatchable()` bridge | Centralized error creation; no classes; gradual migration from old patterns |
| Health caching | 30s TTL, queue/uptime always fresh | Avoids 4s CLI version checks on every healthcheck poll |
| Env loading | dotenv | Standard `.env` file support for local development |
| Test framework | Node.js built-in `node:test` | Zero external test dependencies; built-in mocking, assertions, describe/it |
| Test HTTP client | `supertest` (devDependency) | Tests Express app directly without starting a server |
| Mock strategy | `mock.module()` for CLI providers, `mock.method()` for fetch | Solves CommonJS destructured-import problem; only 5 of 12 test files need module mocking |
| Test scope | 33 tests, 12 suites, < 1s | Fast, deterministic; no real CLIs, no network calls |
