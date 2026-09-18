# ADR-0001 — Baseline: what SheLLM is and the decisions behind it

- **Status:** accepted
- **Date:** 2026-09-18 (records decisions taken from 2026-02 onwards)
- **Supersedes:** `ROADMAP.md`, deleted in the same change

## Context

SheLLM was built over eleven phases as a personal service and its history lived in a roadmap file
that mixed what exists, what was planned and why each call was made. Planned work belongs on the
maintainer's private board; the reasoning belongs here, where a later ADR can reverse it.

This ADR is the baseline every later ADR argues against. It records the decisions as they stand
after the phase 1a revamp, not as they were first made.

## Decision

SheLLM exposes one person's own CLI subscriptions to their own applications over HTTP, in both the
OpenAI and the Anthropic wire formats.

### Load-bearing

| Decision | Rationale |
|---|---|
| Drive official, unmodified CLI binaries | Extracting OAuth tokens or calling provider APIs with subscription credentials breaks provider terms and gets accounts suspended |
| One person, their own subscription, their own apps | Sharing or reselling capacity is what providers enforce against |
| Both API formats are first-class | An SDK pointed at SheLLM works on the first try, whichever one the caller already uses |
| One CLI process per request, discarded after | Context cannot leak between requests; a warm pool must preserve this |
| Node.js, CommonJS, three runtime dependencies | The CLIs are npm packages; no build step, no framework to keep up with |
| Functional provider modules | Three providers do not justify a class hierarchy or a plugin system |
| SQLite (`better-sqlite3`) for data only | Keys, request logs and audit entries; a single file, backup is `cp` |
| Configuration in `$XDG_CONFIG_HOME/shellm/env` | Two sources for one knob disagree silently, and secrets do not belong in the checkout |
| systemd under a dedicated user, bound to `127.0.0.1` | CLI logins live in that user's home and survive deploys; exposure is the operator's tunnel or proxy |
| Static HTML dashboard, no build step | Express serves the files; a frontend toolchain would outweigh three pages |
| `node:test` with real objects and temp dirs | Zero test dependencies, and a green suite means the thing actually runs |
| MIT | Anyone should be able to self-host it with their own subscription |

### Current surface

- `POST /v1/chat/completions`, `POST /v1/messages`, `GET /v1/models`, `GET /health`.
- `/admin/*`: keys, request logs, provider status, guarded by HTTP Basic.
- `shellm` CLI: `init`, `doctor`, `start`, `stop`, `restart`, `status`, `logs`, `update`, `version`.

### Providers

Claude (Claude Code) and Codex (ChatGPT subscription). Gemini was removed: Gemini CLI stopped
serving personal Google plans on 2026-06-18, and Antigravity CLI's terms forbid using the service
in connection with products Google does not provide. The README states the fair-use position.

## Consequences

- Latency is bounded by CLI startup, around 2–4 s per request. A warm pool is the planned fix and
  is gated on measuring it on the server first.
- Quota is the subscription's, so SheLLM stays at human scale: no automatic retries, a concurrency
  cap, and health checks that spend nothing.
- Anything that would make SheLLM faster or more capable by leaving the official binary reopens
  this ADR rather than landing as a PR.

## What this ADR deliberately dropped

The prompt-injection guard, per-client safety levels, the generic HTTP provider (Cerebras), the
model registry table with `SHELLM_ALIASES`, settings stored in SQLite, the Docker image, the
landing page and its screenshot tooling, and the playground and live-terminal dashboard pages.
Each was built for a user this project does not have; the history is in git.
