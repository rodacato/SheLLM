# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-03-23

### Added

- **admin:** add Terminal page with live server output stream
- **admin:** add Live Logs page with terminal-style real-time feed
- **admin:** add live log stream endpoint with event emitter
- **admin:** redesign models page to match design mockup
- **admin:** redesign request logs page with stats summary and improved UX
- **admin:** add sparkline charts, auto-refresh, and cost burn rate to overview
- **admin:** add client description, audit log with UI activity panel
- **dx:** add SQL migrations system and architecture diagram
- **api:** add response_format and top_p parameter passthrough
- **dx:** add pre-commit lint hook and npm run seed for demo data
- **admin:** add error rate and cost-by-provider widgets to overview dashboard
- **admin:** add expires_at display and input to keys UI
- **resilience,streaming:** complete backlog items 5 & 6
- **dx:** add ESLint with flat config, npm audit in CI, fix all lint errors
- **admin:** add error rate breakdown and cost by provider to /admin/stats
- **health:** add webhook alerting on provider health transitions
- **auth:** add key expiration with expires_at field
- **api:** add temperature parameter passthrough to all providers
- **admin:** add Playground page with streaming, redesigned sidebar, and page headers
- **streaming:** add SSE streaming for /v1/chat/completions with client disconnect handling
- **health:** add startup health gate, background poller, and Gemini keychain fix
- **admin:** add CSV log export with filtering and formula injection protection

### Fixed

- **admin:** replace text logo with SVG assets and add SVG favicon
- **db:** replace non-sequential 001b migration with idempotent 004
- **db:** handle pre-existing DBs in migration runner, fix sparkline height
- **security:** improve secret redaction to catch short API key patterns
- **health:** add --approval-mode yolo to Gemini deep check and handle yolo stderr warnings
- **auth:** always require Bearer token, update tests, backlog, and CLAUDE.md
- **screenshots:** replace Puppeteer with Playwright and fix font loading
- **readme:** use SVG logos and add screenshot generation script
- **docs:** fix API docs paths for GitHub Pages and update landing page
- **ci:** update Pages workflow to use modular OpenAPI spec and client-side Redoc

### Documentation

- **backlog:** update #1 Models Page with expert review and current status
- **backlog:** mark #7, #9, #12 as Done
- **backlog:** update status for expires_at UI, dashboard widgets, response_format, seed, redaction
- **backlog:** update status for temperature, key expiry, webhook, error rate, ESLint, npm audit
- **backlog:** add Admin Playground (#14) and quick reference table


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

[Unreleased]: https://github.com/rodacato/SheLLM/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/rodacato/SheLLM/compare/v0.2.0...v0.3.0
