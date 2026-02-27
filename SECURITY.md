# Security Policy

## Architecture

SheLLM is designed as an **internal service**. It is not intended to be exposed to the public internet.

### Network Isolation

- The service binds to `127.0.0.1` (loopback) in production — only accessible from the same host
- When using Docker networking, the service is accessible only from containers on the same bridge network
- **No TLS termination** is performed by SheLLM — this is the responsibility of the reverse proxy (if any)
- **Multi-client bearer token authentication** via `SHELLM_CLIENTS` env var. When not set, auth is disabled (development mode). Network isolation remains the primary trust boundary in production; bearer tokens add defense-in-depth.
- **Rate limiting**: Global + per-client sliding window (requests per minute). Prevents abuse even from trusted internal clients.

### Admin Authentication Hardening

The admin dashboard (`/admin/*`) uses HTTP Basic Auth via `SHELLM_ADMIN_PASSWORD`.

**Brute-force protection:** Failed login attempts are tracked per IP address using an in-memory sliding window. After 5 failures within 5 minutes (configurable via `SHELLM_ADMIN_MAX_ATTEMPTS`), further attempts from that IP are rejected with `429 Too Many Requests` and a `Retry-After` header.

**Audit logging:** All admin authentication attempts (success and failure) are logged via the structured JSON logger. Failed attempts include: IP address, attempted username, and failure reason (`missing_header`, `invalid_encoding`, `invalid_format`, `wrong_password`, `wrong_username`). Successful attempts log the IP and username at `info` level.

**Password strength validation:** At startup, if `SHELLM_ADMIN_PASSWORD` is set, the service warns (via `logger.warn`) if the password is shorter than 12 characters or matches a list of commonly used weak passwords. This is advisory only — the server still starts.

**Username validation:** Optionally, set `SHELLM_ADMIN_USER` to restrict admin access to a specific username. When not set (default), any username is accepted with the correct password. When set, username comparison uses `crypto.timingSafeEqual`.

**Security headers:** The admin dashboard (`/admin/dashboard/*`) is served with restrictive headers:
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Content-Security-Policy` — restricts script/style sources to self + CDNs (Tailwind, Alpine.js)
- `Referrer-Policy: no-referrer` — prevents URL leakage
- `Cache-Control: no-store` — prevents caching of admin pages

### Client Key Management

Client API keys are configured via the `SHELLM_CLIENTS` environment variable (JSON). Keys must never be committed to the repository.

- **Production**: Store in `.env` on the VPS (owned by `shellmer` user, mode 600)
- **Development**: Use `.env` file (gitignored) or leave unset (auth disabled)
- **Pre-commit hook**: `scripts/pre-commit` scans staged changes for secret patterns (`sk-*`, `csk-*`, hardcoded keys). Install with `cp scripts/pre-commit .git/hooks/pre-commit`
- **Timing-safe comparison**: Bearer tokens are compared using `crypto.timingSafeEqual` to prevent timing attacks

### Auth Token Handling

SheLLM manages auth tokens for three CLI tools. These tokens are **equivalent to API keys** and must be treated accordingly.

| Provider | Token Location | Persistence |
|---|---|---|
| Claude Code | `~/.claude/` | Native home dir (`~shellmer/`) |
| Gemini CLI | `~/.gemini/` | Native home dir (`~shellmer/`) |
| Codex CLI | `~/.codex/` | Native home dir (`~shellmer/`) |
| Cerebras | `CEREBRAS_API_KEY` env var | Environment |

**Rules:**

- Auth token directories live in the `shellmer` user's home directory on the VPS — never committed to version control
- `.gitignore` excludes auth directories
- Auth tokens should be rotated by running `sudo -iu shellmer` then `<cli> auth login`

## Input Handling

All user-supplied input passes through sanitization before reaching a CLI subprocess or API call.

### Sanitization (src/middleware/sanitize.js)

- Null bytes (`\0`) are stripped — prevents injection in C-based CLI parsers
- Carriage returns (`\r`) are normalized — prevents log injection
- Input is truncated to **50,000 characters** — prevents memory abuse and excessive token consumption

### Subprocess Safety

- Stdin is set to `ignore` — prevents CLIs from hanging on interactive prompts
- `NO_COLOR=1` is injected — prevents ANSI escape codes in output
- Arguments are passed as an array to `spawn()` — **no shell interpolation**, preventing command injection
- Each subprocess has a configurable timeout (default: 120s) — prevents runaway processes
- Killed processes are cleaned up via `SIGKILL` after timeout

## What This Service Does NOT Protect Against

- **Prompt injection**: SheLLM passes prompts to LLMs as-is. It is the caller's responsibility to construct safe prompts.
- **PII exposure**: SheLLM does not inspect prompt content. Callers must anonymize data before sending it.
- **Rate limiting bypass**: SheLLM has global + per-client rate limiting, but a compromised client key still allows requests up to its RPM limit.
- **CLI vulnerabilities**: If a CLI tool has a vulnerability, SheLLM inherits it. Keep CLI tools updated.

## Reporting Vulnerabilities

If you discover a security issue, do **not** open a public issue. Instead:

1. Email the maintainer directly
2. Include a description of the vulnerability, reproduction steps, and potential impact
3. Allow reasonable time for a fix before disclosure

## Dependency Policy

- **Minimize dependencies.** SheLLM has one runtime dependency (Express). Every additional package increases supply chain risk.
- **Audit before adding.** Before adding any dependency, verify: maintenance status, download count, known vulnerabilities (`npm audit`), and whether a built-in alternative exists.
- **Lock versions.** `package-lock.json` is committed and used for reproducible installs (`npm ci`).
- **No postinstall scripts.** If a dependency runs scripts on install, evaluate whether it's worth the risk.

## Runtime Security

- In production, the service runs as a dedicated **non-root user** (`shellmer`) on the VPS via systemd
- Network access via `cloudflared` tunnel — zero open ports, Cloudflare handles TLS
- Resource limits enforced by systemd unit configuration
- A Dockerfile exists for optional containerized use (development), using `node:22-slim` with non-root `node` user
