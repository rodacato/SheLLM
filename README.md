# SheLLM

Your LLM services — unified as a REST API.

SheLLM consolidates all your LLM access points — CLI subscriptions, API keys, free tiers — into a single, provider-agnostic HTTP endpoint. Any application on your infrastructure can consume LLM capabilities through one unified interface, regardless of how each provider is accessed.

## Why

LLM access is fragmented:

- **CLI subscriptions** (Claude Max, Gemini AI Plus, OpenAI Enterprise) provide CLI tools but no API keys
- **API providers** (Cerebras, Groq, Together AI) offer API keys but each has a different SDK
- **Free tiers** and trial accounts with varying auth mechanisms

Existing solutions like LiteLLM or Portkey assume API keys for everything. SheLLM bridges the gap by supporting **both** CLI-based and API-based providers behind one consistent REST interface.

## Supported Providers

### CLI-Based (Subscription)

| Subscription | CLI Tool | Auth |
| --- | --- | --- |
| Claude Max (~$100/mo) | `claude` (Claude Code) | OAuth → `~/.claude/` |
| Gemini AI Plus | `gemini` (Gemini CLI) | Google OAuth → `~/.gemini/` |
| OpenAI Enterprise | `codex` (Codex CLI) | OpenAI auth → `~/.codex/` |

### API-Based

| Provider | Access | Auth |
| --- | --- | --- |
| Cerebras | REST API | API key |
| *(More providers can be added as simple modules)* | | |

## Quick Start

### Install

```bash
git clone git@github.com:rodacato/SheLLM.git && cd shellm
npm install
cp .env.example .env    # edit with your secrets
npm link                # makes `shellm` CLI available globally
```

### Run

```bash
# Foreground (development)
shellm start

# Background daemon
shellm start -d

# Custom port
shellm start -p 8080

# Verify
curl http://127.0.0.1:6000/health
```

### CLI Commands

```
shellm start [-d|--daemon] [-p|--port PORT]   Start the server
shellm stop                                    Stop the daemon
shellm restart                                 Restart the daemon
shellm status                                  Show server status and health
shellm logs [-f|--follow] [-n|--lines N]       View daemon logs
shellm version                                 Show version
shellm help                                    Show usage
```

### Run Tests

```bash
npm test             # 56 unit tests, 16 suites, < 1s
npm run test:e2e     # end-to-end with real CLIs (requires auth)
```

## Authentication

SheLLM supports multi-client authentication via bearer tokens. Each client gets a unique API key and per-minute rate limit.

### Configuration

Set the `SHELLM_CLIENTS` environment variable with a JSON object:

```bash
SHELLM_CLIENTS='{"stockerly":{"key":"stockerly-shellm-2026","rpm":10},"dev":{"key":"dev-shellm-local","rpm":5}}'
SHELLM_GLOBAL_RPM=30
```

- **`key`**: Unique bearer token for the client (any string you choose)
- **`rpm`**: Max requests per minute for this client
- **`SHELLM_GLOBAL_RPM`**: Max total requests per minute across all clients (default: 30)

| `SHELLM_CLIENTS` | Behavior |
|---|---|
| Not set | Auth disabled — **all requests are allowed** without a token |
| Valid JSON | Auth enabled — requires `Authorization: Bearer <key>` |
| Invalid JSON | Auth disabled + warning in logs |

**Important:** When `SHELLM_CLIENTS` is not set, authentication is completely disabled — all requests are allowed without any token. This is by design for local development, but in production you **must** set `SHELLM_CLIENTS` to restrict access.

### Usage

```bash
curl -H "Authorization: Bearer stockerly-shellm-2026" http://localhost:6000/providers
```

### Request Tracing

Every request gets a `request_id` for traceability. Priority:
1. `X-Request-ID` header (recommended for GET requests)
2. `request_id` field in POST body
3. Auto-generated UUID

## API

### POST /completions *(authenticated)*

```bash
curl -X POST http://localhost:6000/completions \
  -H "Authorization: Bearer stockerly-shellm-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "prompt": "Analyze this data and return JSON",
    "system": "You are a financial analyst. Return valid JSON only.",
    "max_tokens": 1024,
    "request_id": "my-trace-id"
  }'
```

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | Yes | Provider name or model alias (see `GET /providers`) |
| `prompt` | string | Yes | User prompt (max 50,000 characters) |
| `system` | string | No | System prompt |
| `max_tokens` | integer | No | Max output tokens |
| `request_id` | string | No | Caller-assigned ID for tracing |

**Success (200):**

```json
{
  "content": "...",
  "provider": "claude",
  "model": "claude",
  "duration_ms": 3420,
  "request_id": "my-trace-id"
}
```

### GET /health *(unauthenticated)*

Returns provider status, queue stats, and uptime. Unauthenticated for healthcheck probes.

```json
{
  "status": "ok",
  "providers": {
    "claude": { "installed": true, "authenticated": true },
    "gemini": { "installed": true, "authenticated": true },
    "codex": { "installed": true, "authenticated": false },
    "cerebras": { "installed": true, "authenticated": false, "error": "CEREBRAS_API_KEY not set" }
  },
  "queue": { "pending": 0, "active": 1, "max_concurrent": 2 },
  "uptime_seconds": 86400
}
```

### GET /providers *(authenticated)*

Lists available providers with their capabilities and supported models.

### Error Contract

Every error response follows this shape:

```json
{
  "error": "error_type",
  "message": "Human-readable description",
  "request_id": "uuid"
}
```

| Status | Error Type | Description |
|---|---|---|
| 400 | `invalid_request` | Missing/invalid fields, unknown model |
| 401 | `auth_required` | Missing or invalid bearer token |
| 429 | `rate_limited` | Client or global rate limit exceeded (includes `retry_after`) |
| 502 | `cli_failed` | CLI process exited with non-zero code |
| 503 | `provider_unavailable` | Provider not authenticated or misconfigured |
| 504 | `timeout` | Process killed after deadline |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `6000` | Server port |
| `TIMEOUT_MS` | `120000` | Subprocess timeout (ms) |
| `MAX_CONCURRENT` | `2` | Max concurrent CLI processes |
| `MAX_QUEUE_DEPTH` | `10` | Max queued requests before 429 |
| `HEALTH_CACHE_TTL_MS` | `30000` | Health check cache duration (ms) |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SHELLM_CLIENTS` | *(unset)* | Client auth config (JSON). Unset = auth disabled |
| `SHELLM_GLOBAL_RPM` | `30` | Global rate limit (requests/minute) |
| `CEREBRAS_API_KEY` | *(unset)* | Cerebras API key (optional) |

## Logging

SheLLM outputs structured JSON logs to stdout/stderr.

- `debug`/`info` → stdout
- `warn`/`error` → stderr
- Health check requests (`/health`) are logged at `debug` level — suppressed by default
- 4xx → `warn`, 5xx → `error`

Set `LOG_LEVEL=debug` to see all requests including health probes.

Daemon mode logs to `~/.shellm/logs/shellm.log` with logrotate support (daily, 7 rotations, 10MB max).

## Production Deployment (VPS)

SheLLM runs directly on a VPS with systemd and cloudflared. CLI OAuth tokens persist naturally in the home directory — no Docker volume issues.

### First-time setup

```bash
# On the VPS as root
bash scripts/setup-vps.sh
```

This creates a `shellmer` user, installs Node.js 22, CLI tools, clones the repo, configures systemd, and sets up cloudflared.

### Authenticate CLIs

```bash
sudo -iu shellmer
claude auth login
gemini auth login
codex auth login
exit
```

### Start

```bash
sudo systemctl start shellm
sudo systemctl status shellm
journalctl -u shellm -f
```

### Update

```bash
sudo -iu shellmer
cd ~/shellm && git pull && npm ci --omit=dev
exit
sudo systemctl restart shellm
```

## Architecture

```text
Client (Rails, curl, cron)
  │ Authorization: Bearer <key>
  │ POST /completions
  ▼
Express.js server (:6000)
  ├── Request ID (header / body / auto-generated UUID)
  ├── Authentication (multi-client bearer tokens)
  ├── Rate Limiting (global + per-client RPM)
  ├── Validation & Sanitization
  ├── Request Queue (max 2 concurrent)
  └── Provider Router
        │
        ├── CLI Providers (subprocess)
        │   ├── claude.js   → claude --print --output-format json
        │   ├── gemini.js   → gemini -p
        │   └── codex.js    → codex exec --json
        │
        └── API Providers (HTTP client)
            └── cerebras.js → REST API call
```

## Project Structure

```text
shellm/
├── src/
│   ├── server.js            # Express entry point
│   ├── router.js            # Request routing + queue
│   ├── errors.js            # Error factories and response helper
│   ├── health.js            # Health check logic (cached)
│   ├── cli.js               # CLI dispatcher
│   ├── cli/
│   │   ├── paths.js         # Shared path constants (~/.shellm/)
│   │   ├── pid.js           # PID file utilities
│   │   ├── start.js         # Start foreground or daemon
│   │   ├── stop.js          # Stop daemon (SIGTERM → SIGKILL)
│   │   ├── restart.js       # Restart daemon
│   │   ├── status.js        # PID check + health fetch
│   │   ├── logs.js          # Tail daemon log file
│   │   ├── version.js       # Print version
│   │   └── help.js          # Usage text
│   ├── lib/
│   │   └── logger.js        # Structured JSON logger with LOG_LEVEL
│   ├── providers/
│   │   ├── base.js          # Base subprocess runner
│   │   ├── claude.js        # Claude CLI wrapper
│   │   ├── gemini.js        # Gemini CLI wrapper
│   │   ├── codex.js         # Codex CLI wrapper
│   │   └── cerebras.js      # Cerebras API client
│   └── middleware/
│       ├── auth.js          # Multi-client auth + rate limiting
│       ├── request-id.js    # Request ID propagation
│       ├── validate.js      # Request validation
│       ├── sanitize.js      # Input sanitization
│       └── logging.js       # Request logging (level-aware)
├── test/                    # 56 tests, 16 suites
├── config/
│   └── logrotate.conf       # Daemon log rotation
├── scripts/
│   ├── pre-commit           # Git hook (block secrets)
│   └── setup-vps.sh         # VPS provisioning (one-time)
├── shellm.service           # systemd unit file
├── .env.example             # Environment variable template
├── Dockerfile               # Production container (optional)
└── docker-compose.yml       # Docker Compose (optional)
```

## Documentation

| Document | Purpose |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Implementation phases, progress tracking, decision log |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, code conventions, how to add providers |
| [SECURITY.md](SECURITY.md) | Security architecture, input handling, auth token policy |

## License

[MIT](LICENSE)
