# SheLLM — Roadmap

> Last updated: 2026-02-27

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in implementation phases plus a future enhancements backlog.

---

## Phases 1–6 — Summary `COMPLETED`

| Phase | Scope | Key Deliverables |
|---|---|---|
| **1 — Core Service** | Express server, providers, queue, middleware | `src/server.js`, `src/router.js`, `src/providers/` (claude, gemini, codex, cerebras), `src/middleware/`, `src/health.js` |
| **2 — API Contract & Auth** | Multi-client auth, rate limiting, error standardization | `src/errors.js`, `src/middleware/auth.js`, structured logging, pre-commit hook, `.env.example` |
| **3 — Testing** | 56 tests across 16 suites, < 1s runtime | `test/` (unit + integration via `node:test` + `supertest`), `.github/workflows/ci.yml` |
| **4 — Containerization** | Dockerfile, compose (dev use) | `Dockerfile`, `docker-compose.yml`, `.dockerignore` |
| **5 — CLI & Logging** | `shellm` CLI, structured JSON logger, log rotation | `src/cli.js`, `src/cli/*.js`, `src/lib/logger.js`, `config/logrotate.conf` |
| **6 — VPS Deployment** | systemd, cloudflared, provisioning script | `shellm.service`, `scripts/setup-vps.sh` |

**Key architectural decisions (phases 1–6):**
- CommonJS, two runtime dependencies (Express + dotenv), functional provider modules
- Queue: max 2 concurrent, max 10 depth, in-memory; 120s subprocess timeout
- Multi-client bearer tokens via `SHELLM_CLIENTS` JSON env var; auth disabled when unset
- Timing-safe token comparison; global + per-client sliding-window RPM
- Health cache: 30s TTL for provider status; queue/uptime always fresh
- Tests mock at subprocess boundary (`mock.module()`) and fetch (`mock.method()`); no real CLIs in CI
- `shellm` CLI complements systemd — convenience for dev, systemd for production
- LOG_LEVEL filtering (debug/info/warn/error); health probes at `debug` level
- Direct VPS deployment (not containerized) — CLI OAuth tokens persist in `~shellmer/`
- cloudflared tunnel to `shellm.notdefined.dev` — zero open ports, Cloudflare handles TLS

---

## Phase 7 — Provider Fallback & Streaming `IN PROGRESS`

Improve reliability with automatic provider fallback and add real-time streaming support.

### 7a — Provider Fallback

When a provider fails (502, 503, 504), automatically retry with an alternative provider. The caller gets a response without needing to know which provider served it.

| Task | Status | Files |
|---|---|---|
| Fallback configuration (env var or per-request) | Pending | `src/router.js` |
| Fallback chain logic in router | Pending | `src/router.js` |
| Response includes `fallback: true` + original error | Pending | `src/router.js` |
| Health-aware fallback (skip unauthenticated providers) | Pending | `src/router.js`, `src/health.js` |
| Unit tests for fallback scenarios | Pending | `test/router.test.js` |

**Design notes:**
- Default fallback order: `claude → gemini → cerebras` (configurable via `SHELLM_FALLBACK_CHAIN` env var)
- Only retry on 502 (`cli_failed`), 503 (`provider_unavailable`), 504 (`timeout`) — NOT on 400/401/429
- Max 1 fallback attempt (no cascading retries beyond one alternate)
- Response shape adds optional fields: `{ fallback: true, original_provider, original_error }`
- Caller can disable fallback per-request with `"fallback": false` in POST body
- Health check data used to skip providers known to be down (avoids wasting time)

### 7b — Streaming Support

SSE endpoint for real-time token-by-token output. Essential for interactive use cases.

| Task | Status | Files |
|---|---|---|
| `POST /completions/stream` endpoint | Pending | `src/server.js` |
| SSE response writer utility | Pending | `src/lib/sse.js` |
| Claude CLI streaming (`--stream-json`) | Pending | `src/providers/claude.js` |
| Gemini CLI streaming (stdout pipe) | Pending | `src/providers/gemini.js` |
| Cerebras API streaming (SSE from API) | Pending | `src/providers/cerebras.js` |
| Base provider stream support | Pending | `src/providers/base.js` |
| Unit tests for streaming | Pending | `test/streaming.test.js` |

**Design notes:**
- SSE format: `data: {"content": "token", "done": false}\n\n`
- Final event: `data: {"content": "", "done": true, "provider": "claude", "duration_ms": 3420}\n\n`
- Reuse same auth/rate-limiting middleware as `/completions`
- CLI providers: pipe subprocess stdout line-by-line
- API providers: proxy SSE stream from upstream API
- Fallback NOT supported in streaming mode (too complex for v1)

---

## Future Enhancements `BACKLOG`

Features to consider after Phase 7 is stable in production.

| Feature | Description | Effort | Priority |
|---|---|---|---|
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
| Auth persistence | Native home dir (`~shellmer/`) | Docker volumes broke on rebuilds; native FS survives CLI updates and deploys |
| Port binding | 127.0.0.1 only | Internal service, not internet-facing |
| Queue implementation | In-memory array | Low volume (< 100 req/day), no Redis needed |
| System prompt handling | `--system-prompt` for Claude, prepend for others | Avoids wasted tokens on CLI agentic scaffolding |
| Response format | Unified JSON | Caller doesn't care which provider answered |
| Authentication | Multi-client bearer tokens via env var | Supports multiple consumers with individual rate limits; disabled in dev |
| Rate limiting | Global + per-client RPM (sliding window) | Protects VPS from overload while giving each client a fair share |
| Client config | `SHELLM_CLIENTS` JSON env var | Public-repo safe (GitHub Secrets); no file-based config to leak |
| Error handling | Factory functions + `fromCatchable()` bridge | Centralized error creation; no classes; gradual migration from old patterns |
| Health caching | 30s TTL, queue/uptime always fresh | Avoids 4s CLI version checks on every healthcheck poll |
| Env loading | dotenv | Standard `.env` file support for local development |
| Test framework | Node.js built-in `node:test` | Zero external test dependencies; built-in mocking, assertions, describe/it |
| Test HTTP client | `supertest` (devDependency) | Tests Express app directly without starting a server |
| Mock strategy | `mock.module()` for CLI providers, `mock.method()` for fetch | Solves CommonJS destructured-import problem; only 5 of 12 test files need module mocking |
| Deployment model | Direct on VPS (not containerized) | CLI OAuth tokens break on container rebuilds; native install keeps auth stable |
| Process manager | systemd | Native, zero deps, auto-restart, journalctl integration |
| Network access | cloudflared tunnel (`shellm.notdefined.dev`) | Zero open ports, Cloudflare handles TLS, no nginx/caddy needed |
| CLI tool | `shellm` bin via npm link | Convenient dev/ad-hoc management; complements systemd, doesn't replace it |
| Logger | Structured JSON, LOG_LEVEL filter | Health probes (every 30s) suppressed at `info`; 5xx → `error` for alerting |
| Log rotation | System logrotate, `copytruncate` | No signal handling in app; daily, 7 rotations, 10M max |
| License | MIT | Open source, permissive, standard for Node.js ecosystem |
