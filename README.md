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
| Gemini AI Plus | `gemini` (Gemini CLI) | Google OAuth → `~/.config/` |
| OpenAI Enterprise | `codex` (Codex CLI) | OpenAI auth → `~/.codex/` |

### API-Based

| Provider | Access | Auth |
| --- | --- | --- |
| Cerebras | REST API | API key |
| *(More providers can be added as simple modules)* | | |

## Quick Start

### Development (Docker Compose)

```bash
git clone <repo-url> && cd shellm
docker compose up --build

curl http://localhost:6000/health
```

### Development (Local)

```bash
npm install
npm run dev

npm test
```

## API

### POST /completions

```bash
curl -X POST http://localhost:6000/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "prompt": "Analyze this data and return JSON",
    "system": "You are a financial analyst. Return valid JSON only.",
    "max_tokens": 1024
  }'
```

**Response:**

```json
{
  "content": "...",
  "provider": "claude",
  "model": "claude-sonnet-4-5-20250514",
  "duration_ms": 3420,
  "request_id": "optional-caller-id"
}
```

The response format is the same regardless of whether the provider is CLI-based or API-based.

### GET /health

Returns provider status, queue stats, and uptime.

### GET /providers

Lists available providers and their capabilities.

## Auth Setup

### CLI Providers

After deploying, authenticate each CLI once:

```bash
docker exec -it shellm claude auth login
docker exec -it shellm gemini auth login
docker exec -it shellm codex auth login
```

Auth tokens persist in Docker volumes — survives restarts and redeployments.

### API Providers

Set API keys via environment variables:

```bash
CEREBRAS_API_KEY=csk-...
```

## Production Deployment (Kamal)

Add as a Kamal accessory in your `config/deploy.yml`:

```yaml
accessories:
  shellm:
    image: ghcr.io/<your-org>/shellm:latest
    host: <%= ENV["HOST_IP"] %>
    port: "127.0.0.1:6000:6000"
    directories:
      - llm_claude_auth:/home/bridge/.claude
      - llm_config:/home/bridge/.config
      - llm_codex_auth:/home/bridge/.codex
    options:
      memory: 768m
      cpus: "1.0"
```

## Architecture

```text
Client (Rails, curl, cron)
  │ HTTP POST /completions
  ▼
Express.js server (:6000)
  ├── Validation & Sanitization
  ├── Request Queue (max 2 concurrent)
  └── Provider Router
        │
        ├── CLI Providers (subprocess)
        │   ├── claude.js   → claude -p --output-format json
        │   ├── gemini.js   → gemini -p
        │   └── codex.js    → codex exec --json
        │
        └── API Providers (HTTP client)
            └── cerebras.js → REST API call
```

## Adding a New Provider

Each provider is a single module that implements `buildArgs/buildRequest` and `parseOutput/parseResponse`. CLI providers spawn subprocesses; API providers make HTTP requests. Both return the same unified response format.

## Project Structure

```text
shellm/
├── src/
│   ├── server.js            # Express entry point
│   ├── router.js            # Request routing + queue
│   ├── health.js            # Health check logic
│   ├── providers/
│   │   ├── base.js          # Base subprocess runner
│   │   ├── claude.js        # Claude CLI wrapper
│   │   ├── gemini.js        # Gemini CLI wrapper
│   │   ├── codex.js         # Codex CLI wrapper
│   │   └── cerebras.js      # Cerebras API client
│   └── middleware/
│       ├── validate.js      # Request validation
│       ├── sanitize.js      # Input sanitization
│       └── logging.js       # Request/response logging
├── scripts/
│   ├── setup-auth.sh        # Interactive auth setup
│   └── check-auth.sh        # Verify CLI auth
├── test/
├── Dockerfile
└── docker-compose.yml
```

## Documentation

| Document | Purpose |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, code conventions, how to add providers |
| [SECURITY.md](SECURITY.md) | Security architecture, input handling, auth token policy |
| [IDENTITY.md](IDENTITY.md) | Project lead profile and architectural standards |
| [EXPERTS.md](EXPERTS.md) | Expert panel for technical and domain decisions |
| [AGENTS.md](AGENTS.md) | AI agent instructions and project context |
| [ROADMAP.md](ROADMAP.md) | Implementation phases, progress tracking, decision log |

## License

Private — Internal use only.
