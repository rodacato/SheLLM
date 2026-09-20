# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-20

### Upgrade notes

**Re-run `scripts/setup/vps.sh` once after this update.** An upgrade is performed by the updater
of the release you are leaving, and that one only re-installed `shellm.service`. The systemd
units, the `tmpfiles.d` entry and the updater script this release adds therefore do not arrive
with it. From the next release onwards `sudo shellm update` keeps the whole set in step on its
own, and never enables anything.

The dashboard's update button is **not** in this release — only the privileged half it will use.
That half stays inert until you opt in with `sudo systemctl enable --now shellm-update.path`.

### Added

- **deploy:** the privileged half of the update button
- **admin:** a playground that calls /v1 with a client key
- **admin:** say what failed and what the runtime is doing
- **keys:** show what a key has spent, and let its limits be edited
- **logs:** record what a request asked for and why it failed

### Fixed

- **deploy:** make the updater report the failures it cannot survive
- **admin:** send an expired session to the login page, not a Basic prompt

### Documentation

- **deployment:** make `shellm update` the documented way to upgrade


## [1.1.1] - 2026-09-19

### Fixed

- **admin:** allow the release check the dashboard's own CSP was blocking

### Documentation

- **adr:** decide the privilege split for the update button


## [1.1.0] - 2026-09-19

### Breaking Changes

- **A host now follows published releases, not a branch.** `vps.sh` checks out the newest tag
  and leaves the checkout detached, so on an existing install `git pull` stops updating
  anything — it reports success and changes nothing. Upgrade by re-running `vps.sh`, or with
  `shellm update`, which resolves the same ref. `SHELLM_REF` pins a specific release, or a
  branch on purpose.

### Added

- **setup:** install codex on the host, pinned to CODEX_VERSION
- **setup:** deploy a published release instead of a branch tip

### Fixed

- **admin:** read shared state from the scope, not from $root — the dashboard's version, uptime,
  status and queue panels were reading an element instead of the data, and showed empty or zero
- **health:** serve the real status and the CLI versions from the poller's cache — `/admin/health`
  reported `ok` regardless of provider state, so anything trusting it as a health signal was
  trusting a constant
- **release:** stop CI from opening the pull request, and surface the breaking changes

### Documentation

- **adr:** correct the threat this decision was argued from

### CI

- fail the audit on advisories, not on the registry being down


## [1.0.0] - 2026-09-19

### Breaking Changes

Upgrading from `0.5.0` meets all of these at once. None of the commits behind them carried a
`!` marker, so they are recorded here by hand.

- **Gemini is gone.** The provider was removed after Gemini CLI stopped serving personal Google
  plans; requests naming a gemini model now fail.
- **The generic HTTP provider and Cerebras are gone.** SheLLM drives CLI subprocesses only.
- **The models table was dropped.** Model names map to CLI aliases in code, so a model added by
  editing the database is no longer recognised.
- **Configuration moved out of SQLite** into `~/.config/shellm/env`. Settings written to the
  database are ignored; the migration drops that table.
- **The prompt injection guard was removed.** SheLLM does not inspect prompt content — isolating
  what the CLI can reach is the defense that works.
- **The dashboard was trimmed** to keys, logs and provider status; the models page it used to
  carry no longer exists.

### Added

- **admin:** report the running build and let a provider be paused
- **service:** stop the service from writing the code it runs
- **claude:** run one-shot requests with the CLI's internal tools off
- **admin:** rebuild the overview around capacity, latency and usage
- **admin:** aggregate capacity, latency layers and per-model usage
- **codex:** pass the model, sandbox the run, and serialize the CLI
- **claude:** stop the CLI from inheriting the operator's setup
- **bench:** measure time to first text, and re-measure one scenario
- **bench:** add a capability and latency runner for a live instance
- **admin:** make the dashboard installable on a phone
- **admin:** sign in on a login page instead of the browser dialog
- **setup:** slim vps.sh down to provisioning and add vps-uninstall.sh
- **cli:** add shellm init
- **cli:** add shellm doctor
- **providers:** pass CLAUDE_CODE_OAUTH_TOKEN to the claude CLI
- **providers:** pass the requested model to the CLI

### Fixed

- **health:** probe with a free command and stop guessing a logout
- **metrics:** record every billable token and the CLI's own timings
- **errors:** answer /v1 errors in the format the caller speaks
- **claude:** stream the CLI's tokens instead of flushing at the end
- **health:** probe providers with their own environment
- **test:** drop gemini from the CLI contract suite
- **cli:** make shellm status work against the minimal /health
- **api:** list only models that map to a CLI model in /v1/models
- **config:** read configuration from ~/.config/shellm/env
- **providers:** run each CLI in its own temporary directory
- **server:** bind to 127.0.0.1 by default
- **devcontainer:** trust the workspace mount for git
- **devcontainer:** regenerate from the baseline templates with local.env
- **providers:** stop passing temperature flags the CLIs reject
- **devcontainer:** resolve node_modules permissions and rename service to workspace

### Changed

- drop the Gemini-only health heuristic

### Documentation

- **adr:** decide how releases are cut, deployed and applied
- describe the probe the providers now own
- **audience:** record knowing the quota as a need of its own
- publish the codex measurement and correct what the docs claimed
- **benchmarks:** publish the flag measurement, including the nil result
- **api:** describe /v1 errors in the caller's format
- **guides:** correct the streaming finding and refresh the guides
- **guides:** add a usage guide and the first production benchmark
- regroup .env.example and drop the settings nothing reads
- point VERSIONS.md at vps.sh instead of the deleted Dockerfile
- correct the architecture guide and drop the served landing page
- update the contributor guide and the seed script
- rewrite the deployment guide for the current setup
- **api:** align the OpenAPI spec with the real surface
- rewrite the README around what SheLLM does today
- replace ROADMAP.md with ADR-0001 and refresh the agent instructions
- state the fair-use position on provider subscriptions
- move work tracking to the private project board
- rewrite identity and expert panel around a new audience doc
- add .notdefined.yml project metadata

### Maintenance

- **scripts:** convert release-changelog to CommonJS
- **lint:** lint the scripts directory
- remove Docker, the landing page and the screenshot tooling
- **setup:** replace dev.sh and check-env.js with init and doctor
- remove the unused .notdefined.yml
- **deps:** refresh transitive dependencies with npm update
- allow better-sqlite3's install script
- **devcontainer:** add the Pencil extension and commit the lockfile
- **docker:** bump gemini-cli to 0.60.0 and codex to 0.154.0
- **deps:** update dependencies to their latest releases
- ignore only the local agent and devcontainer files
- **devcontainer:** align with the shared baseline

### Testing

- **admin:** assert the CSV export against the stored columns
- **providers:** keep every configured variable out of the CLI env
- **cli:** check provider arguments against the real CLI binaries

### CI

- **release:** cut a release from a dispatch instead of seven local steps
- bump the GitHub Pages actions to their Node 24 majors
- run every workflow on Node 24 with the v7 actions
- add the security and quality gate
- name the test job and bound its runs


## [0.5.0] - 2026-03-25

### Added

- **admin:** sidebar with uptime, health endpoint, and docs links

### Fixed

- **test:** use standard API ID formats and fix all failing tests
- **stream:** prevent zombie slots and fix headers-after-flush crash
- **cli:** use npm run migrate and remove unused import

### Changed

- organize scripts/ with setup/ subfolder and release- prefixes
- move v1/ to api/v1/
- extract app.js from server.js
- split db/index.js by domain and co-locate migrations
- extract infra/ and routing/ from God modules

### Documentation

- add architecture guide with module overview and request flow


## [0.4.1] - 2026-03-24

### Added

- **cli:** add shellm update command for easy VPS deploys
- **auth:** support x-api-key header for Anthropic SDK compatibility

### Fixed

- **cli:** run git commands as shellmer to avoid safe.directory error
- **compat:** align streaming format, IDs, and model names with upstream APIs
- **docs:** serve API docs from /docs/ endpoint on VPS

### Documentation

- **deployment:** simplify update instructions and add alias tip


## [0.4.0] - 2026-03-24

### Added

- **admin:** separate CLI/API provider sections with templates
- **providers:** generic HTTP provider engine + CRUD from admin UI
- **admin:** complete settings system with Tier 2/3 and category grouping
- **admin:** add model CRUD controls to provider cards
- **admin:** add hot-reloadable settings system
- **admin:** normalize providers and models into database
- **compat:** improve OpenAI and Anthropic API compatibility
- **security:** per-client safety profiles with X-SheLLM-Safety header
- **security:** add prompt injection guard middleware
- **site:** add subtle animations to GitHub Pages landing

### Fixed

- **service:** add CLI paths to systemd PATH
- **scripts:** clarify .env path in post-setup instructions
- **scripts:** clarify user context in post-setup steps and fix port
- **scripts:** clean up root-level CLI installs before shellmer setup
- **scripts:** install LLM CLIs as shellmer user with npm prefix
- **scripts:** use HTTPS for git clone in VPS setup
- **admin:** make settings values look like editable inputs
- **admin:** unify toggle switches across dashboard
- **security:** hardening fixes
- **security:** important security fixes
- **security:** critical security hardening
- **security:** harden subprocess env to prevent credential leakage
- **lint:** resolve 7 eslint errors breaking CI
- **release:** auto-update version in site/index.html during npm version
- **docs:** update landing page version to v0.3.0

### Documentation

- **deployment:** fix port references (6000→6100), add FAQ section
- **guides:** add VPS deployment guide and improve Getting Started
- **guides:** add API compatibility guide for OpenAI and Anthropic
- **guides:** add prompt safety guide for developers
- **security:** update documentation for security hardening
- **readme:** update supported models list with all current model aliases

### Maintenance

- ignore plan files


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

[Unreleased]: https://github.com/rodacato/SheLLM/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/rodacato/SheLLM/compare/v1.1.1...v1.2.0
