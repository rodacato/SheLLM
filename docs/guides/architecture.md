# Architecture Guide

SheLLM is a lightweight Node.js/Express service that wraps LLM CLI tools (Claude Code, Codex CLI) as a unified REST API. It runs as a single process with SQLite for persistence.

---

## Directory Structure

```
src/
├── server.js              # Process lifecycle: DB init, listen, shutdown, signals
├── app.js                 # Express app: middleware chain, route mounting, static files
├── errors.js              # Error factories (invalidRequest, rateLimited, etc.)
├── cli.js                 # CLI dispatcher (shellm command)
├── cli/                   # CLI subcommands (init, doctor, start, stop, status, logs, …)
│
├── routing/               # Request routing and provider dispatch
│   ├── index.js           # route() — main dispatch + barrel exports
│   ├── engines.js         # Engine registry (one entry per CLI provider)
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
│   ├── codex.js           # Codex CLI adapter
│
├── api/v1/                # API endpoint handlers (versioned)
│   ├── chat-completions.js # POST /v1/chat/completions (OpenAI format)
│   ├── messages.js        # POST /v1/messages (Anthropic format)
│   └── models.js          # GET /v1/models
│
├── middleware/            # Express middleware
│   ├── auth.js            # Bearer token auth + per-client/global rate limiting
│   ├── admin-auth.js      # Basic auth for admin dashboard
│   ├── request-id.js      # Request ID generation/pass-through
│   ├── logging.js         # Request/response logging to DB
│   └── sanitize.js        # Input normalization
│
├── db/                    # SQLite persistence layer
│   ├── index.js           # DB lifecycle (initDb/closeDb/getDb) + barrel re-exports
│   ├── clients.js         # Client CRUD + key hashing (HMAC-SHA256, legacy SHA-256)
│   ├── request-logs.js    # Request log insertion and pruning
│   ├── providers.js       # Provider CRUD and settings
│   ├── audit.js           # Admin audit log
│   ├── migrate.js         # Migration runner (one statement at a time, one transaction per file)
│   └── migrations/        # SQL migration files (001–013)
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
│   └── public/            # Dashboard frontend (vanilla JS SPA)
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
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────┐
│  Handler (api/v1/)        │
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

1. **engines.js** — Maintains the `engines` registry object; every provider is a CLI subprocess registered at require-time.

3. **provider-select.js** — `selectProvider(model)` resolves a model to an engine, then runs fail-fast checks: is the provider enabled? Is it authenticated (from cached health)? Is the circuit breaker allowing traffic?

4. **fallback.js** — When fallback is enabled, tries providers in priority order, skipping unavailable ones. Does not fallback on 400-level client errors.

### infra/ — Reliability Primitives

1. **queue.js** — `RequestQueue` limits concurrent CLI executions. Default: 2 concurrent, 10 queue depth. Returns 429 when full. Settings are hot-reloadable from DB.

2. **circuit-breaker.js** — Per-provider state machine: `closed → open → half_open → closed`. Opens after 3 consecutive failures (configurable). Resets after 60s timeout. Only allows one probe request in half_open state.

3. **stream-slots.js** — Separate concurrency counter for streaming requests (default: 2). Prevents streams from monopolizing all queue slots.

4. **health.js** — Background polling of provider health. It asks the provider module for a probe that spends no quota (`authProbe`) and runs it through the provider's own lock when it has one; a provider without a probe falls back to `--version`, which proves installation only. A failure it cannot classify is recorded as an unknown, never as a logout. Caches results with configurable TTL. Fires webhook alerts on status transitions.

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
4. Export an `authProbe` (a free command plus a parser) from the provider module

### db/ — Persistence

SQLite (better-sqlite3) with synchronous API. Each domain has its own module:

- **clients.js** — API key management with HMAC-SHA256 hashing. Legacy SHA-256 keys are auto-upgraded on successful auth.
- **providers.js** — Provider registry with capabilities JSON and health check config.

Migrations live in `src/db/migrations/` and run automatically on startup. `migrate.js` applies a
file one statement at a time inside a single transaction: a `duplicate column` error is ignored for
an `ALTER TABLE` and nothing else, and any other failure rolls the file back and leaves it
unrecorded, so it is retried on the next start.

### middleware/ — Request Processing

Middleware runs in order — changing the order changes behavior:

1. `express.json()` — Parse JSON body (256kb limit)
2. `requestId` — Extract `x-request-id` header or generate UUID
3. `requestLogger` — Log request completion with timing, status, provider
4. Content-Type check — Reject non-JSON POST/PATCH
5. `auth` — Validate Bearer token, check rate limits (global + per-client)

---

## Dependency Graph

```
server.js
  └── app.js
        ├── middleware/*
        ├── api/v1/*
        │     └── routing/ (route, selectProvider, queue, stream-slots)
        ├── admin/*
        │     ├── db/* (clients, providers, audit)
        │     └── routing/ (engines)
        └── infra/health (getHealthStatus)

routing/
  ├── index.js (route function)
  ├── engines.js → providers/*
  ├── provider-select.js → engines, infra/circuit-breaker, infra/health
  └── fallback.js → provider-select, engines, infra/queue, infra/circuit-breaker

infra/
  ├── queue.js → errors
  ├── stream-slots.js (no deps)
  ├── circuit-breaker.js → lib/logger
  └── health.js → queue, circuit-breaker, providers/base, db

db/
  ├── index.js (lifecycle + barrel)
  ├── clients.js → index (getDb)
  ├── request-logs.js → index (getDb)
  ├── providers.js → index (getDb)
  ├── audit.js → index (getDb)
  └── migrate.js (no deps)
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
- **The service does not deploy itself** — It reports what it is running and can request an
  update; a privileged component outside the process performs one, checking out a published tag.
  See [ADR-0003](../adr/0003-release-and-update-cycle.md) for why the two halves are separate.

See [IDENTITY.md](../IDENTITY.md) for the full decision-making framework and project principles.
