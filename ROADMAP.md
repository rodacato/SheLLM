# SheLLM — Roadmap

> Last updated: 2026-02-26

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in five implementation phases plus a future enhancements backlog.

---

## Phases 1–3 — Summary `COMPLETED`

| Phase | Scope | Key Deliverables |
|---|---|---|
| **1 — Core Service** | Express server, providers, queue, middleware | `src/server.js`, `src/router.js`, `src/providers/` (claude, gemini, codex, cerebras), `src/middleware/`, `src/health.js` |
| **2 — API Contract & Auth** | Multi-client auth, rate limiting, error standardization | `src/errors.js`, `src/middleware/auth.js`, structured logging, pre-commit hook, `.env.example` |
| **3 — Testing** | 33 tests across 12 suites, < 1s runtime | `test/` (unit + integration via `node:test` + `supertest`), `.github/workflows/ci.yml` |

**Key architectural decisions (phases 1–3):**
- CommonJS, single runtime dependency (Express), functional provider modules
- Queue: max 2 concurrent, max 10 depth, in-memory; 120s subprocess timeout
- Multi-client bearer tokens via `SHELLM_CLIENTS` JSON env var; auth disabled when unset
- Timing-safe token comparison; global + per-client sliding-window RPM
- Health cache: 30s TTL for provider status; queue/uptime always fresh
- Tests mock at subprocess boundary (`mock.module()`) and fetch (`mock.method()`); no real CLIs in CI

---

## Phase 4 — Containerization `COMPLETED`

Production-ready Docker setup with CLI installations and auth management scripts.

| Task | Status | Files |
|---|---|---|
| Production Dockerfile with CLI installations | Done | `Dockerfile` |
| Production docker-compose.yml | Done | `docker-compose.yml` |
| Auth setup script (interactive) | Done | `scripts/setup-auth.sh` |
| Auth check script (verification) | Done | `scripts/check-auth.sh` |
| Docker build context filter | Done | `.dockerignore` |

**Key decisions made:**
- Single-stage build (no compile step — plain CommonJS)
- `node:22-slim` base, minimal system packages (curl, jq only — no sudo/editors)
- CLI version-pinned via `ARG`: Gemini 0.30.0, Codex 0.105.0, Claude Code via native installer (latest)
- Non-root `node` user at runtime; auth dirs as empty volume mount points
- `127.0.0.1:6000` loopback-only binding; 768MB RAM, 1.0 CPU limits
- HEALTHCHECK hits `GET /health` endpoint (not TCP); 60s start-period for CLI cold starts
- `CMD ["node", "src/server.js"]` exec form — Node.js is PID 1, receives SIGTERM
- Secrets via `.env` file (`env_file` directive), never in compose or image layers
- Log rotation: json-file driver, 10MB x 3 files

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
| Dockerfile stages | Single-stage (no multi-stage) | No compile/transpile step; plain CommonJS has no build artifacts to separate |
| Production base image | `node:22-slim` + curl + jq only | Minimal attack surface; no sudo, editors, or dev tools |
| CLI version pinning | `ARG` for Gemini/Codex; Claude via native installer | Reproducible builds; Claude installer has no version pin option |
| Container entrypoint | `CMD` exec form (no `ENTRYPOINT`) | Node.js is PID 1, receives signals; allows `docker run shellm bash` override |
| Resource limits | 768MB RAM, 1.0 CPU | Accommodates Node.js heap + 2 concurrent CLI subprocesses |
| Log rotation | json-file, 10MB x 3 | Prevents disk exhaustion on low-volume VPS |
