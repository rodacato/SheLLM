# Architecture Guide

SheLLM is one Node.js/Express process that runs the official Claude Code and Codex CLIs as
subprocesses and answers in the OpenAI and Anthropic formats. SQLite holds keys and logs.

This guide is the map: what each area is responsible for, the order things happen in, and the
contracts that are not obvious from any single file. Values (defaults, limits, timeouts) live in
[`src/config/schema.js`](../../src/config/schema.js), not here.

---

## Map

```
src/
├── server.js          # Process lifecycle: config file, DB init, listen, health poller, shutdown
├── app.js             # Middleware chain and every route mount; the order is behavior
├── errors.js          # Error factories, and sendApiError, which picks the response shape by path
├── cli.js             # The `shellm` command; one file per subcommand under cli/
├── config/            # Every setting and its default (ADR-0008)
├── api/v1/            # OpenAI and Anthropic handlers: validate, translate, stream, shape usage
├── routing/           # Model to provider, availability checks, queue, fallback
├── providers/         # One adapter per CLI, plus the subprocess runner they share
├── infra/             # Queue, circuit breaker, stream slots, health, metrics, model catalog,
│                      # limits and prices, the updater behind /admin/update
├── middleware/        # Auth, admin auth, CORS, request id, logging, error handler
├── db/                # SQLite: one module per table group, the migration runner and its files
├── lib/               # Logger, SSE writers, token redaction, shared helpers
├── catalog/           # Baked model list, used when the CLIs cannot be asked
└── admin/             # Dashboard routes, server-side views, and the browser app in public/
```

The modules a newcomer needs first:

- `src/routing/engines.js` — the provider registry. Everything that dispatches reads it.
- `src/routing/index.js` — `route()`, the non-streaming path: select, enqueue, call, record.
- `src/providers/base.js` — the only place a subprocess is spawned. It builds the minimal
  environment and the per-request temp directory, and captures `PATH` when it loads.
- `src/config/schema.js` — every setting, its default and whether it reloads live.
- `src/infra/health.js` — the probes that decide whether a provider is authenticated.

`src/middleware/sanitize.js` is a function the handlers call, not middleware that `app.js` mounts.

---

## Request Flow

```
HTTP request
  │
  ▼
middleware chain (src/app.js, order below)
  │
  ▼
handler (api/v1/)
  validate the body, check the key's model list, sanitize prompt and system
  │
  ▼
routing/index.js: route()        (streams take the same steps in the handler,
  1. selectProvider(model)        and also hold a stream slot inside the queue slot)
       resolveProvider()          model name to engine
       checkProviderAvailability  enabled? authenticated? circuit allows it?
  2. queue.enqueue()              concurrency gate, 429 when the queue is full
  3. provider.chat()              spawn the CLI
  4. recordSuccess/Failure        circuit breaker; a 4xx is not the provider's failure
  │
  ▼
provider (providers/)
  prompt on stdin; claude reads its system prompt from a 0600 file in the request's
  temp directory, codex gets it prepended to the prompt; stdout decoded as UTF-8.
  Streams send headers at once, a `: keepalive` comment on an interval so a
  silent model does not trip the tunnel's idle timeout, and an error event if the
  CLI is killed.
  │
  ▼
response in the caller's format
```

### Middleware order

Changing the order changes behavior:

1. `requestLogger` — logs completion and records metrics. Gateway metrics count only requests
   where a CLI started (`res.locals.cli_ms`); a successful `/health` or `/metrics` is not logged.
2. `corsV1` — on `/v1` only, before the body parser and before `auth`: a 400 or 413 from the
   parser still reaches the browser, and a preflight, which carries no credentials, is answered.
3. JSON body parser — a small limit for every path except `/v1/chat/completions`, which is parsed
   after `auth` up to `SHELLM_MAX_CHAT_BODY_BYTES`, so a caller without a key never gets more than
   a header read.
4. `requestId` — `x-request-id` header, `request_id` in the body, or a new UUID.
5. Content-Type check — rejects non-JSON POST/PATCH, except the admin login and logout forms.
6. `auth`, per route — bearer key, the key's origin list and monthly spend limit (ADR-0013),
   global and per-client rate limits.

After the routes, an unmatched path gets a JSON 404, and `errorHandler` turns anything passed to
`next(err)` into the error shape the path speaks, never Express's HTML page.

### Error shapes

Errors are built with the factories in `src/errors.js` and sent with `sendApiError`, which picks
the shape from the path: Anthropic's for `/v1/messages` (or any `/v1/` call carrying
`anthropic-version`), OpenAI's for the rest of `/v1/`, and a flat
`{ error, message, request_id }` everywhere else.

---

## Reliability

- **Queue** (`src/infra/queue.js`) — limits concurrent CLI processes and answers 429 when the
  waiting line is full. Its limits are read on every call, so changing them needs no restart.
- **Circuit breaker** (`src/infra/circuit-breaker.js`) — per provider,
  `closed → open → half_open → closed`. In `half_open` exactly one probe request gets through.
- **Stream slots** (`src/infra/stream-slots.js`) — a second cap that only streams take, inside
  their queue slot, so long streams cannot hold every slot.
- **Fallback** (`src/routing/fallback.js`) — when enabled, tries the other providers in
  `SHELLM_FALLBACK_ORDER`, or their DB priority order, skipping unavailable ones. A 4xx is the caller's error and never falls back.
- **Health** (`src/infra/health.js`) — polls each provider with its `authProbe`, which spends no
  quota, through the provider's own lock when it has one. A provider without a probe falls back to
  `--version`, which proves installation only. A failure it cannot classify is recorded as unknown,
  never as a logout: guessing "logged out" once took a whole provider offline. Fires webhook alerts
  on status changes.

---

## Providers

A provider is a plain object exported by `src/providers/<name>.js`.
[`src/providers/claude.js`](../../src/providers/claude.js) and
[`src/providers/codex.js`](../../src/providers/codex.js) are the reference; what the rest of the
app relies on is:

```javascript
module.exports = {
  name: 'provider-name',
  // Names that route here. GET /v1/models lists these plus what the CLI's catalog reports, and
  // any id starting with "provider-name-" also routes here.
  models: ['provider-name'],
  // Merged over base.js's minimal environment (PATH, HOME, TMPDIR, NO_COLOR).
  env: { /* only what this CLI needs */ },
  // parts: null, or the prompt as text and image parts in order. effort: low|medium|high.
  // longContext: the caller sent the context-1m beta. max_tokens, temperature and top_p are
  // passed too and ignored: neither CLI has a flag for them.
  chat: async ({ prompt, parts, system, response_format, model, effort, longContext }) =>
    ({ content, cost_usd, usage, metrics }),
  // Optional. Yields { type: 'delta', content }, { type: 'usage', ... }, then { type: 'done' };
  // signal aborts when the client disconnects.
  chatStream: async function* ({ ...same, signal }) {},
  // A command that costs no quota, and a parser that answers true, false, or null (cannot tell).
  authProbe: { args: ['auth', 'status'], parse: (stdout, stderr) => true },
  // Optional. Health probes run inside it, so they do not race a request (codex holds one).
  withLock: async (fn) => fn(),
};
```

`usage` is Anthropic-shaped for every provider, because one logging path serves them all:
`input_tokens` is the **fresh** input only, with `cache_read_input_tokens` and
`cache_creation_input_tokens` beside it rather than inside it, and `output_tokens` already
includes any reasoning tokens. A CLI that counts another way converts in its own adapter — codex
reports cache reads inside its `input_tokens`, so it subtracts them. A counter the CLI did not
report is **omitted**, which the log stores as NULL; a reported zero is stored as `0`.

### Adding a provider

Read the provider's terms first: SheLLM only drives official binaries with the owner's own
subscription (see the README's fair-use section). Then:

1. Write `src/providers/<name>.js` to the contract above, spawning through `execute()` from
   `src/providers/base.js`.
2. Register it in `src/routing/engines.js`.
3. Add a migration in `src/db/migrations/` that inserts its row into `providers`. Health checks,
   fallback order and the enable switch read that table, not the registry.
4. Pin its CLI in `config/cli-versions/package.json`, and teach the installers about it:
   `scripts/setup/vps.sh`, `src/cli/update.js` and the pin check in `src/cli/doctor.js` each name
   their CLIs explicitly.
5. Put limits the CLI does not report in `config/model-limits.yaml` (ADR-0009).
6. Tests in `test/providers/`, and add it to `test/cli/contract.cli.js` and
   `test/e2e/providers.e2e.js`, so an upstream flag or output change is caught.
7. Record the tested version in `VERSIONS.md`.

---

## Persistence

SQLite through better-sqlite3, synchronous, one module per table group under `src/db/`. Client
keys are stored as HMAC-SHA256; a legacy SHA-256 key is upgraded on its next successful auth.

Migrations in `src/db/migrations/` run on every start. `src/db/migrate.js` applies a file one
statement at a time inside a single transaction: a `duplicate column` error is ignored for an
`ALTER TABLE` and nothing else, and any other failure rolls the file back and leaves it
unrecorded, so it is retried on the next start.

---

## Design Decisions

- **CommonJS, no TypeScript, no build step** — the code runs as written, and a stack trace points
  at the file you edit.
- **Express only, no ORM** — raw SQL in prepared statements; the schema is small enough that an
  ORM adds a layer without removing a problem.
- **SQLite, not Postgres** — one file, no server, no connection pool. Synchronous calls keep the
  code straight.
- **Subprocess providers** — the CLIs are spawned, never imported as SDKs, so authentication stays
  the CLI's own subscription login on the host.
- **Debuggability first** — when in doubt, choose what is easiest to debug at 2 AM.
- **The service does not deploy itself** — it reports what it runs and can request an update; a
  privileged component outside the process checks out a published tag. See
  [ADR-0003](../adr/0003-release-and-update-cycle.md).

See [IDENTITY.md](../IDENTITY.md) for the principles behind these.
