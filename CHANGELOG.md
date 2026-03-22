# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-03-22

### Added

- **branding:** replace text wordmarks with inline SVG logo across all surfaces
- **assets:** generate PNG favicons from SVG using sharp
- **assets:** add SVG logos and favicon extracted from Stitch design
- **runtime:** apply terminal_core tokens to server splash page
- **admin:** redesign dashboard with terminal_core dark theme
- **pages:** redesign GitHub Pages with terminal_core spec
- **community:** add issue templates, PR template, CODEOWNERS, and README badges
- **release:** adopt conventional commits and automate CHANGELOG + GitHub Releases
- **dx:** add check:env script and setup-dev.sh onboarding guide
- **docs:** add Redocly dark theme config and custom HTML template
- **pages:** add GitHub Pages site with CI deploy workflow

### Fixed

- **admin:** fix favicon 404s and Alpine expression errors on dashboard
- **assets:** tighten wordmark SVG viewBox to 264x64
- **assets:** restore favicon PNG fallbacks with new filenames across all surfaces

### Changed

- **docs:** modularize OpenAPI spec into docs/api/ with client-side Redoc

### Documentation

- Add BACKLOG.md file to track upcoming changes
- **redesign:** add BACKLOG.md and redesign implementation plan
- **guides:** add branding.md — step-by-step design and branding guide
- **guides:** add releasing.md — step-by-step release guide
- expand expert panel with permanent/situational roles and add comparison section

### Maintenance

- **docs:** move EXPERTS.md and IDENTITY.md into docs/ and update AGENTS.md
- update Material Symbols font URL parameters
- **assets:** replace PNG favicons with icon-color SVG favicon
- remove legacy branding/ directory
- **assets:** migrate to assets/ structure — Phase 1 of redesign


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

[Unreleased]: https://github.com/rodacato/SheLLM/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rodacato/SheLLM/compare/v0.1.0...v0.2.0
