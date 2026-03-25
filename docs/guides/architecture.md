# Architecture Guide

SheLLM is a lightweight Node.js/Express service that wraps LLM CLI tools (Claude Code, Gemini CLI, Codex CLI) and HTTP APIs (Cerebras) as a unified REST API. It runs as a single process with SQLite for persistence.

---

## Directory Structure

```
src/
├── server.js              # Process lifecycle: DB init, listen, shutdown, signals
├── app.js                 # Express app: middleware chain, route mounting, static files
├── errors.js              # Error factories (invalidRequest, rateLimited, etc.)
├── cli.js                 # CLI dispatcher (shellm command)
├── cli/                   # CLI subcommands (start, stop, restart, status, logs, etc.)
│
├── routing/               # Request routing and provider dispatch
│   ├── index.js           # route() — main dispatch + barrel exports
│   ├── engines.js         # Engine registry (subprocess + HTTP providers)
│   ├── model-cache.js     # Model-to-provider mapping, aliases, cache invalidation
│   ├── provider-select.js # Provider selection, availability checks, fail-fast
│   └── fallback.js        # Fallback routing across providers, provider listing
│
├── infra/                 # Infrastructure and reliability primitives
│   ├── queue.js           # RequestQueue — concurrency control (max_concurrent, max_queue_depth)
│   ├── circuit-breaker.js # Per-provider circuit breaker (closed → open → half_open)
│   ├── stream-slots.js    # Streaming concurrency slots (acquireStreamSlot/releaseStreamSlot)
│   └── health.js          # Provider health checks, caching, background polling, alerts
│
├── providers/             # LLM provider adapters
│   ├── base.js            # Subprocess execution (spawn, timeout, output capture, env isolation)
│   ├── claude.js          # Claude Code CLI adapter
│   ├── gemini.js          # Gemini CLI adapter
│   ├── codex.js           # Codex CLI adapter
│   └── http-generic.js    # Generic OpenAI-compatible HTTP provider factory
│
├── v1/                    # API endpoint handlers
│   ├── chat-completions.js # POST /v1/chat/completions (OpenAI format)
│   ├── messages.js        # POST /v1/messages (Anthropic format)
│   └── models.js          # GET /v1/models
│
├── middleware/            # Express middleware
│   ├── auth.js            # Bearer token auth + per-client/global rate limiting
│   ├── admin-auth.js      # Basic auth for admin dashboard
│   ├── request-id.js      # Request ID generation/pass-through
│   ├── logging.js         # Request/response logging to DB
│   ├── sanitize.js        # Input normalization + safety level dispatch
│   └── prompt-guard.js    # Prompt injection detection (tier 1 + tier 2 patterns)
│
├── db/                    # SQLite persistence layer
│   ├── index.js           # DB lifecycle (initDb/closeDb/getDb) + barrel re-exports
│   ├── clients.js         # Client CRUD + key hashing (HMAC-SHA256, legacy SHA-256)
│   ├── request-logs.js    # Request log insertion and pruning
│   ├── providers.js       # Provider CRUD and settings
│   ├── models.js          # Model CRUD and aliases
│   ├── audit.js           # Admin audit log
│   ├── settings.js        # Hot-reloadable settings registry (DB → env → default)
│   └── migrations/        # SQL migration files (001–009)
│
├── lib/                   # Shared utilities
│   ├── logger.js          # Structured JSON logger (level-aware)
│   ├── sse.js             # Server-Sent Events helpers (OpenAI format)
│   ├── sse-anthropic.js   # Anthropic-specific SSE formatting
│   └── log-emitter.js     # Event emitter for live log streaming
│
├── admin/                 # Admin dashboard backend
│   ├── keys.js            # API key management routes
│   ├── logs.js            # Request log query routes
│   ├── stats.js           # Analytics routes
│   ├── providers.js       # Provider management routes
│   ├── settings.js        # Settings management routes
│   └── public/            # Dashboard frontend (vanilla JS SPA)
│
└── public/                # Public landing page
```

---

## Request Flow

```
HTTP Request
  │
  ▼
┌─────────────────────────────────────────────┐
│  Express Middleware Chain                     │
│  1. express.json()          parse body       │
│  2. requestId               generate/extract │
│  3. requestLogger           log completion   │
│  4. Content-Type check      POST/PATCH only  │
│  5. auth (Bearer token)     validate + rate  │
│  6. safetyHeader            set X-SheLLM-*   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────┐
│  Handler (v1/)            │
│  • Validate request body  │
│  • Extract messages       │
│  • Sanitize + guard       │
│  • Check model allowlist  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│  routing/index.js — route()                   │
│  1. selectProvider(model)                     │
│     ├─ resolveProvider()    model → engine    │
│     └─ checkAvailability()  enabled? auth?    │
│                              circuit ok?      │
│  2. queue.enqueue()         concurrency gate  │
│  3. provider.chat()         subprocess/HTTP   │
│  4. recordSuccess/Failure   circuit breaker   │
└──────────┬───────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│  Provider (providers/)                        │
│  subprocess: spawn CLI, capture stdout/stderr │
│  http: fetch to upstream OpenAI-compat API    │
└──────────┬───────────────────────────────────┘
           │
           ▼
  Response (OpenAI or Anthropic format)
```

---

## Key Modules

### routing/ — Provider Dispatch

The routing layer maps a model name to a provider engine and dispatches the request:

1. **engines.js** — Maintains the `engines` registry object. Subprocess providers (claude, gemini, codex) are registered at require-time. HTTP providers (cerebras, custom) are registered dynamically from the DB via `registerHttpProviders()`.

2. **model-cache.js** — Builds and caches a `modelToProvider` map from the `models` DB table. Falls back to engine `validModels` arrays when the DB isn't available (tests, early boot). Supports model aliases via SHELLM_ALIASES env var.

3. **provider-select.js** — `selectProvider(model)` resolves a model to an engine, then runs fail-fast checks: is the provider enabled? Is it authenticated (from cached health)? Is the circuit breaker allowing traffic?

4. **fallback.js** — When fallback is enabled, tries providers in priority order, skipping unavailable ones. Does not fallback on 400-level client errors.

### infra/ — Reliability Primitives

1. **queue.js** — `RequestQueue` limits concurrent CLI executions. Default: 2 concurrent, 10 queue depth. Returns 429 when full. Settings are hot-reloadable from DB.

2. **circuit-breaker.js** — Per-provider state machine: `closed → open → half_open → closed`. Opens after 3 consecutive failures (configurable). Resets after 60s timeout. Only allows one probe request in half_open state.

3. **stream-slots.js** — Separate concurrency counter for streaming requests (default: 2). Prevents streams from monopolizing all queue slots.

4. **health.js** — Background polling of provider health. Subprocess providers: run `--version`. HTTP providers: check env var + optional URL fetch. Caches results with configurable TTL. Fires webhook alerts on status transitions.

### providers/ — Provider Adapters

Every provider implements this interface:

```javascript
{
  name: 'provider-name',
  chat: async ({ prompt, system, max_tokens, temperature, top_p, response_format, model }) => {
    return { content, cost_usd, usage };
  },
  chatStream: async function* ({ ... }, { signal }) { ... },  // optional
  validModels: ['model-a', 'model-b'],
  capabilities: { supports_system_prompt, supports_json_output, ... },
}
```

**Adding a new subprocess provider:**

1. Create `src/providers/<name>.js` implementing the interface above
2. Register it in `src/routing/engines.js`: `const name = require('../providers/<name>'); engines[name] = ...`
3. Add a migration to seed the provider and its models in the DB
4. Add a health check entry in the provider's DB row

**Adding a new HTTP provider:**

1. Add a row to the `providers` table (type: 'http') with capabilities and health_check config
2. Add model rows to the `models` table
3. The `http-generic.js` factory will automatically create an engine from the DB config

### db/ — Persistence

SQLite (better-sqlite3) with synchronous API. Each domain has its own module:

- **clients.js** — API key management with HMAC-SHA256 hashing. Legacy SHA-256 keys are auto-upgraded on successful auth.
- **providers.js** — Provider registry with capabilities JSON and health check config.
- **models.js** — Model registry with aliases and upstream model mapping.
- **settings.js** — Hot-reloadable key-value config. Fallback chain: DB → env var → default.

Migrations live in `src/db/migrations/` and run automatically on startup.

### middleware/ — Request Processing

Middleware runs in order — changing the order changes behavior:

1. `express.json()` — Parse JSON body (256kb limit)
2. `requestId` — Extract `x-request-id` header or generate UUID
3. `requestLogger` — Log request completion with timing, status, provider
4. Content-Type check — Reject non-JSON POST/PATCH
5. `auth` — Validate Bearer token, check rate limits (global + per-client)
6. `safetyHeader` — Set `X-SheLLM-Safety` based on client safety_level

---

## Dependency Graph

```
server.js
  └── app.js
        ├── middleware/*
        ├── v1/*
        │     └── routing/ (route, selectProvider, queue, stream-slots)
        ├── admin/*
        │     ├── db/* (clients, providers, models, audit)
        │     └── routing/ (engines, invalidateModelCache)
        └── infra/health (getHealthStatus)

routing/
  ├── index.js (route function)
  ├── engines.js → providers/*
  ├── model-cache.js → engines, db/models
  ├── provider-select.js → engines, model-cache, infra/circuit-breaker, infra/health
  └── fallback.js → provider-select, engines, infra/queue, infra/circuit-breaker

infra/
  ├── queue.js → db/settings, errors
  ├── stream-slots.js (no deps)
  ├── circuit-breaker.js → lib/logger
  └── health.js → queue, circuit-breaker, providers/base, db

db/
  ├── index.js (lifecycle + barrel)
  ├── clients.js → index (getDb)
  ├── request-logs.js → index (getDb)
  ├── providers.js → index (getDb)
  ├── models.js → index (getDb)
  ├── audit.js → index (getDb)
  └── settings.js → index (getDb)
```

---

## Design Decisions

- **CommonJS, not ESM** — No transpilation step. `require()` is synchronous and debuggable.
- **Express only** — No Nest, Fastify, or framework additions. Boring technology wins.
- **SQLite, not Postgres** — Single-file database. No connection pool, no migration tooling. `better-sqlite3` is synchronous, which simplifies the code.
- **No ORM** — Raw SQL in prepared statements. The schema is small enough that an ORM adds complexity without value.
- **Subprocess providers** — CLI tools are invoked via `spawn()`, not SDK imports. This keeps auth isolated to the host (CLI subscriptions, not API keys).
- **No TypeScript** — The codebase is ~3000 lines. TypeScript would add a build step for a project that fits in your head.
- **Debuggability > simplicity > elegance** — When in doubt, choose the option that's easiest to debug at 2 AM.

See [IDENTITY.md](../IDENTITY.md) for the full decision-making framework and project principles.
