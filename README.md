# SheLLM

Your LLM services — unified as a REST API.

SheLLM turns CLI subscriptions (Claude Max, Gemini AI Plus, OpenAI Enterprise) and API providers (Cerebras) into a single HTTP endpoint. One interface, any provider.

> Existing solutions like LiteLLM assume API keys for everything. SheLLM supports **both** CLI-based and API-based providers.

## Quick Start

```bash
git clone git@github.com:rodacato/SheLLM.git && cd shellm
npm install
cp .env.example .env
npm link
shellm start
```

Verify it's running:

```bash
curl http://127.0.0.1:6000/health
```

## Usage

```bash
curl -X POST http://localhost:6000/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "prompt": "Explain quicksort in one paragraph"
  }'
```

Response:

```json
{
  "content": "Quicksort is a divide-and-conquer algorithm...",
  "provider": "claude",
  "model": "claude",
  "duration_ms": 3420,
  "request_id": "a1b2c3d4"
}
```

## Supported Providers

| Provider | Type | Models |
|---|---|---|
| Claude Code | CLI | `claude`, `claude-sonnet`, `claude-haiku`, `claude-opus` |
| Gemini CLI | CLI | `gemini`, `gemini-pro`, `gemini-flash` |
| Codex CLI | CLI | `codex` |
| Cerebras | API | `cerebras`, `cerebras-8b`, `cerebras-120b`, `cerebras-qwen` |

See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-new-provider) to add your own.

## API

### POST /completions

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | Yes | Provider or model alias |
| `prompt` | string | Yes | User prompt (max 50,000 chars) |
| `system` | string | No | System prompt |
| `max_tokens` | integer | No | Max output tokens |
| `request_id` | string | No | Your trace ID |

### GET /health

Returns provider status, queue stats, and uptime. No auth required.

### GET /providers

Lists available providers with capabilities and models. Requires auth.

### Errors

```json
{ "error": "error_type", "message": "Human-readable description", "request_id": "uuid" }
```

| Status | Type | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad input |
| 401 | `auth_required` | Missing or invalid token |
| 429 | `rate_limited` | Too many requests (includes `retry_after`) |
| 502 | `cli_failed` | CLI exited with error |
| 503 | `provider_unavailable` | Provider not configured |
| 504 | `timeout` | Process killed after deadline |

## Authentication

Set `SHELLM_CLIENTS` to enable multi-client auth with per-client rate limits:

```bash
SHELLM_CLIENTS='{"myapp":{"key":"my-secret-token","rpm":10}}'
```

Then pass the token as a bearer header:

```bash
curl -H "Authorization: Bearer my-secret-token" http://localhost:6000/completions ...
```

When `SHELLM_CLIENTS` is not set, auth is disabled (all requests allowed). See [.env.example](.env.example) for all configuration options.

## CLI

```
shellm start [-d] [-p PORT]   Start server (foreground or daemon)
shellm stop                    Stop daemon
shellm restart                 Restart daemon
shellm status                  Show PID and health
shellm logs [-f] [-n N]        View daemon logs
shellm version                 Show version
```

## Deployment

SheLLM runs on a VPS with systemd and cloudflared. See the full deployment guide:

```bash
# On the VPS as root
bash scripts/setup-vps.sh
```

This creates a `shellmer` user, installs Node.js 22, CLI tools, configures systemd, and sets up cloudflared. After setup, authenticate each CLI and start the service:

```bash
sudo -iu shellmer
claude auth login && gemini auth login && codex auth login
exit
sudo systemctl start shellm
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code conventions, testing, and how to add providers.

## License

[MIT](LICENSE)
