# SheLLM — Roadmap

> Last updated: 2026-02-26

## Overview

SheLLM wraps LLM CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) as a unified REST API. The project is organized in four implementation phases plus a future enhancements backlog.

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

## Phase 2 — Containerization `PLANNED`

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

## Phase 3 — Testing `PLANNED`

Mocked subprocess tests, API endpoint tests, and queue/concurrency tests.

| Task | Status | Files |
|---|---|---|
| Unit tests for each provider (mocked subprocess) | Pending | `test/providers/` |
| API endpoint tests | Pending | `test/server.test.js` |
| Queue and concurrency tests | Pending | `test/router.test.js` |

**Approach:**
- Node.js built-in test runner (`node --test`)
- Mock at the `execute()` boundary — no real CLI calls in CI
- Express app imported directly — no server.listen in tests
- Target: ~25-30 test cases, < 5s total runtime

---

## Phase 4 — Deployment `PLANNED`

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
