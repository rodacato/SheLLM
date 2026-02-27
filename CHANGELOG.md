# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-27

First public release. SheLLM turns CLI subscriptions and API providers into a
single REST API — one interface, any provider.

### Added

- **Core service** — Express server with provider abstraction, in-memory queue
  (max 2 concurrent, max 10 depth), and 120s subprocess timeout.
- **Providers** — Claude Code CLI, Gemini CLI, Codex CLI (subprocess-based),
  Cerebras (HTTP API). Per-provider enable/disable toggle.
- **OpenAI-compatible endpoint** — `POST /v1/chat/completions` and
  `GET /v1/models` for drop-in compatibility with any OpenAI SDK.
- **Anthropic-compatible endpoint** — `POST /v1/messages` for Claude Code and
  Anthropic SDK compatibility.
- **Model aliases** — `SHELLM_ALIASES` env var maps custom names to providers
  (e.g. `{"gpt-4":"claude"}`).
- **SQLite persistence** — `better-sqlite3` with WAL mode for API key storage
  and request logging. Auto-prune after 30 days.
- **API key management** — Admin CRUD API for bearer token auth. SHA-256 hashed
  keys, runtime create/rotate/revoke without restart. Auth disabled when no
  keys exist.
- **Per-key model restrictions** — Optional `models` whitelist per API key.
- **Rate limiting** — Per-key RPM limits with `Retry-After` header.
- **Admin dashboard** — Browser SPA at `/admin/dashboard/` (Alpine.js v3 +
  Tailwind CSS 4, no build step). Pages: Overview (provider health, queue
  stats, metrics), Request Logs (filterable, paginated), API Keys (full CRUD),
  Models (per-provider listing).
- **Token usage extraction** — Parse token counts and cost from Claude and
  Gemini CLI output.
- **Queued time tracking** — `queued_ms` exposed in API responses and dashboard.
- **Admin auth hardening** — Rate-limited login (5 attempts, 5-min lockout),
  timing-safe password comparison, security headers.
- **`shellm` CLI** — `start`, `stop`, `restart`, `status`, `logs`, `version`,
  `paths` commands. Daemon mode with PID file.
- **Structured logging** — JSON logger with `LOG_LEVEL` filtering and logrotate
  config.
- **API hardening** — Input validation, 256KB body limit, 50K prompt cap,
  Content-Type enforcement, graceful shutdown (30s drain).
- **Observability** — `X-Queue-Depth`/`X-Queue-Active` headers, `duration_ms`
  in errors, health endpoint with provider status.
- **Health endpoint** — `GET /health` with provider checks, queue stats, uptime.
- **OpenAPI 3.1 spec** — Machine-readable API documentation at `/docs/`.
- **Public landing page** — Overview page at `/` with links to docs and dashboard.
- **Branding** — Logo, favicon assets, and style guide.
- **Deployment** — systemd service, cloudflared tunnel, VPS provisioning script
  (`scripts/setup-vps.sh`).
- **Smoke test suite** — `npm run smoke` for automated provider health checks.
- **Test suite** — 180+ tests across 28 files using `node:test` + `supertest`,
  runs in under 1 second.

[Unreleased]: https://github.com/rodacato/SheLLM/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rodacato/SheLLM/releases/tag/v0.1.0
