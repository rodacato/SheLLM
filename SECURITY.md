# Security Policy

## Architecture

SheLLM is designed as an **internal service**. It is not intended to be exposed to the public internet.

### Network Isolation

- The service binds to `127.0.0.1` (loopback) in production — only accessible from the same host
- When using Docker networking, the service is accessible only from containers on the same bridge network
- **No TLS termination** is performed by SheLLM — this is the responsibility of the reverse proxy (if any)
- **Multi-client bearer token authentication** managed via the Admin API. Set `SHELLM_REQUIRE_AUTH=true` (default) to reject all requests when no API keys are configured. Network isolation remains the primary trust boundary in production; bearer tokens add defense-in-depth.
- **Rate limiting**: Global + per-client sliding window (requests per minute). Prevents abuse even from trusted internal clients.
- **Auth failure alerting**: Spikes in auth failures (default: 10/min) fire a webhook to `SHELLM_ALERT_WEBHOOK_URL` for incident response.

### Admin Authentication Hardening

The admin dashboard (`/admin/*`) uses HTTP Basic Auth via `SHELLM_ADMIN_PASSWORD`.

**Brute-force protection:** Failed login attempts are tracked per IP address using an in-memory sliding window. After 5 failures within 5 minutes (configurable via `SHELLM_ADMIN_MAX_ATTEMPTS`), further attempts from that IP are rejected with `429 Too Many Requests` and a `Retry-After` header.

**Audit logging:** All admin authentication attempts (success and failure) are logged via the structured JSON logger. Failed attempts include: IP address, attempted username, and failure reason (`missing_header`, `invalid_encoding`, `invalid_format`, `wrong_password`, `wrong_username`). Successful attempts log the IP and username at `info` level.

**Password strength enforcement:** At startup, if `SHELLM_ADMIN_PASSWORD` is set, the service warns if the password is shorter than 12 characters or matches a list of commonly used weak passwords. **In production (`NODE_ENV=production`), the server refuses to start with a weak password.**

**Password env cleanup:** After reading `SHELLM_ADMIN_PASSWORD` into a closure, the value is deleted from `process.env` to prevent accidental leakage to subprocesses.

**Username validation:** Optionally, set `SHELLM_ADMIN_USER` to restrict admin access to a specific username. When not set (default), any username is accepted with the correct password. When set, username comparison uses `crypto.timingSafeEqual`.

**Security headers:** The admin dashboard (`/admin/dashboard/*`) is served with restrictive headers:
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Content-Security-Policy` — restricts script/style sources to self + CDNs (Tailwind, Alpine.js)
- `Referrer-Policy: no-referrer` — prevents URL leakage
- `Cache-Control: no-store` — prevents caching of admin pages

### Client Key Management

Client API keys are managed via the Admin API (`/admin/keys`). Keys are stored hashed using **HMAC-SHA256** with a server-side secret (auto-generated or via `SHELLM_HMAC_SECRET`). Legacy SHA-256 hashes are auto-upgraded to HMAC on first successful auth.

- **Production**: Database file stored on VPS (owned by `shellmer` user, mode 600, directory mode 700)
- **Development**: In-memory or file DB — when no keys exist and `SHELLM_REQUIRE_AUTH=false`, auth is disabled
- **Key expiration**: Expired keys are automatically marked inactive by a daily cleanup job
- **Pre-commit hook**: `scripts/pre-commit` scans staged changes for secret patterns (`sk-*`, `csk-*`, hardcoded keys). Install with `cp scripts/pre-commit .git/hooks/pre-commit`

### Per-Client Safety Profiles

Each API client has a `safety_level` that controls prompt injection detection behavior:

| Level | Tier 1 (shell commands, etc.) | Tier 2 threshold | Response header | Use case |
|---|---|---|---|---|
| `strict` (default) | Blocks immediately | 2 patterns | `X-SheLLM-Safety: full` | External or untrusted input |
| `standard` | Blocks immediately | 3 patterns | `X-SheLLM-Safety: standard` | Semi-trusted internal input |
| `permissive` | Not checked | Not checked | `X-SheLLM-Safety: reduced` | Fully trusted batch jobs |

- Default for new clients: `strict`
- Changed via: `PATCH /admin/keys/:id { "safety_level": "permissive" }`
- Every `permissive` request logs a `WARN` event (`prompt_guard_bypassed`)
- The `X-SheLLM-Safety` response header is always present on authenticated endpoints

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

- **NFKC normalization** — canonicalizes Unicode to prevent homoglyph and fullwidth character bypasses
- **Zero-width character stripping** — removes U+200B-200F, U+2028-202F, U+FEFF, U+00AD
- Null bytes (`\0`) are stripped — prevents injection in C-based CLI parsers
- Carriage returns (`\r`) are normalized — prevents log injection
- Input is truncated to **50,000 characters** — prevents memory abuse and excessive token consumption

### Prompt Injection Detection (src/middleware/prompt-guard.js)

Two-tier pattern-based detection with NFKC-normalized input:

- **Tier 1** (blocks immediately): shell commands, file access, env exfiltration, role override, system prompt leak
- **Tier 2** (heuristic): base64 injection, fake delimiters, authority claims — blocks when 2+ patterns match (3+ for `standard` safety level)

**Disabling the guard:**
- `SHELLM_PROMPT_GUARD=DISABLED_UNSAFE` — disables in any environment
- `SHELLM_PROMPT_GUARD=false` — disables in development only (ignored in production)
- Per-client: set `safety_level: 'permissive'` via Admin API

### Subprocess Safety

- Stdin is set to `ignore` — prevents CLIs from hanging on interactive prompts
- `NO_COLOR=1` is injected — prevents ANSI escape codes in output
- **Output sanitization** — ANSI escape codes and control characters are stripped from CLI responses
- Arguments are passed as an array to `spawn()` — **no shell interpolation**, preventing command injection
- Each subprocess has a configurable timeout (default: 120s) — prevents runaway processes
- **Process group kill** — subprocesses run in detached mode; timeout kills the entire process group (including grandchild processes)
- **Environment isolation** — subprocesses receive only PATH, HOME, TMPDIR, NO_COLOR (via `buildSafeEnv()`)

### Health Endpoint

- `GET /health` — returns only `{ status: "ok" }` (unauthenticated, for Docker healthcheck)
- `GET /health/detailed` — returns full provider status, queue depth, circuit breakers (requires admin auth)

## Accepted Risks

### Claude CLI `--dangerously-skip-permissions`

The Claude CLI provider uses `--dangerously-skip-permissions` for non-interactive mode. This gives the LLM unrestricted tool use within the container. **Compensating controls:**

- Container runs with `read_only: true` filesystem
- Process runs as non-root user
- Configurable via `SHELLM_CLAUDE_SKIP_PERMISSIONS=false` to disable the flag

### Claude CLI Installer

The Claude CLI is installed via `curl https://claude.ai/install.sh | bash`. No official checksum is available. The installer runs during Docker build (not runtime) as non-root user `node`. Gemini and Codex CLIs are version-pinned via npm.

### CSP `unsafe-inline` / `unsafe-eval`

The admin dashboard CSP allows `unsafe-inline` and `unsafe-eval` for Tailwind CSS CDN and Alpine.js. Mitigated by: dashboard is behind Basic auth, not public-facing.

## What This Service Does NOT Protect Against

- **Prompt injection (complete)**: Pattern-based detection is defense-in-depth, not a guarantee. Motivated attackers can bypass regex patterns.
- **PII exposure**: SheLLM does not inspect prompt content. Callers must anonymize data before sending it.
- **Rate limiting bypass**: A compromised client key still allows requests up to its RPM limit.
- **CLI vulnerabilities**: If a CLI tool has a vulnerability, SheLLM inherits it. Keep CLI tools updated.

## Reporting Vulnerabilities

If you discover a security issue, do **not** open a public issue. Instead:

1. Email the maintainer directly
2. Include a description of the vulnerability, reproduction steps, and potential impact
3. Allow reasonable time for a fix before disclosure

## Dependency Policy

- **Minimize dependencies.** SheLLM has three runtime dependencies (Express, dotenv, better-sqlite3). Every additional package increases supply chain risk.
- **Audit before adding.** Before adding any dependency, verify: maintenance status, download count, known vulnerabilities (`npm audit`), and whether a built-in alternative exists.
- **Lock versions.** `package-lock.json` is committed and used for reproducible installs (`npm ci`).
- **No postinstall scripts.** If a dependency runs scripts on install, evaluate whether it's worth the risk.
- **CI audit:** Run `npm run audit:security` to check for high/critical vulnerabilities.

## Runtime Security

- In production, the service runs as a dedicated **non-root user** (`shellmer`) on the VPS via systemd
- Network access via `cloudflared` tunnel — zero open ports, Cloudflare handles TLS
- Resource limits enforced by systemd unit configuration
- Docker container runs with `read_only: true` filesystem, tmpfs for `/tmp` and data directories
- `LOG_LEVEL=debug` in production emits a startup warning (may expose sensitive data)
