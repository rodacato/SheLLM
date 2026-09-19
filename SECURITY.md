# Security Policy

## Architecture

SheLLM is designed as an **internal service**. It is not intended to be exposed to the public internet.

### Network Isolation

- The service binds to `127.0.0.1` (loopback) in production — only accessible from the same host
- **No TLS termination** is performed by SheLLM — this is the responsibility of the reverse proxy (if any)
- **Multi-client bearer token authentication** managed via the Admin API. Set `SHELLM_REQUIRE_AUTH=true` (default) to reject all requests when no API keys are configured. Network isolation remains the primary trust boundary in production; bearer tokens add defense-in-depth.
- **Rate limiting**: Global + per-client sliding window (requests per minute). Prevents abuse even from trusted internal clients.
- **Auth failure alerting**: Spikes in auth failures (default: 10/min) fire a webhook to `SHELLM_ALERT_WEBHOOK_URL` for incident response.

### Admin Authentication Hardening

The admin dashboard (`/admin/*`) authenticates in two ways against the same `SHELLM_ADMIN_PASSWORD`:

- **Browsers** sign in at `/admin/login` and get a session cookie: HMAC-signed with a key derived from the database's key-hashing secret, `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS, scoped to `/admin`, valid 12 hours, cleared by `POST /admin/logout`. Sessions are stateless — there is nothing to steal from the server, and rotating the secret invalidates every one of them.
- **Scripts** keep using HTTP Basic, so `curl -u admin:… /admin/keys` still works.

A cookie-authenticated request that is not a GET is refused when the browser reports `Sec-Fetch-Site` as anything but `same-origin`, which is what stops a cross-site form from using the session.

### Dashboard assets and the service worker

The SPA's own files (JS, CSS, images, the manifest and the worker) are served without a session — they carry no account data — while `/admin/dashboard/` itself and every `/admin/*` API route need one. The service worker caches that shell and nothing else: it ignores non-GET requests, anything cross-origin, and any path outside its hardcoded shell list, so no key, log or provider response is ever written to a device's cache.

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

### Auth Token Handling

SheLLM manages auth tokens for three CLI tools. These tokens are **equivalent to API keys** and must be treated accordingly.

| Provider | Token Location | Persistence |
|---|---|---|
| Claude Code | `~/.claude/` | Native home dir (`~shellmer/`) |
| Codex CLI | `~/.codex/` | Native home dir (`~shellmer/`) |

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

### Subprocess Safety

- Stdin is set to `ignore` — prevents CLIs from hanging on interactive prompts
- `NO_COLOR=1` is injected — prevents ANSI escape codes in output
- **Output sanitization** — ANSI escape codes and control characters are stripped from CLI responses
- Arguments are passed as an array to `spawn()` — **no shell interpolation**, preventing command injection
- Each subprocess has a configurable timeout (default: 120s) — prevents runaway processes
- **Process group kill** — subprocesses run in detached mode; timeout kills the entire process group (including grandchild processes)
- **Environment isolation** — subprocesses receive only PATH, HOME, TMPDIR, NO_COLOR (via `buildSafeEnv()`)

### Health Endpoint

- `GET /health` — returns only `{ status: "ok" }` (unauthenticated liveness probe)
- `GET /health/detailed` — returns full provider status, queue depth, circuit breakers (requires admin auth)

## Accepted Risks

- **Provider account suspension**: SheLLM drives subscription CLIs on your behalf. Volume that looks automated can get an account suspended, and with it every product tied to it. See [Fair use and provider terms](README.md#fair-use-and-provider-terms).

### Claude CLI `--dangerously-skip-permissions`

The Claude CLI provider uses `--dangerously-skip-permissions` for non-interactive mode. This gives the LLM unrestricted tool use within the container. **Compensating controls:**

- Container runs with `read_only: true` filesystem
- Process runs as non-root user
- Configurable via `SHELLM_CLAUDE_SKIP_PERMISSIONS=false` to disable the flag

### Claude CLI Installer

`scripts/setup/vps.sh` installs Claude Code with `curl https://claude.ai/install.sh | bash -s <version>`, pinned to `CLAUDE_VERSION` and run as the unprivileged service user. The installer publishes no checksum, so the pin is what makes an install reproducible.

### CSP `unsafe-inline` / `unsafe-eval`

The admin dashboard CSP allows `unsafe-inline` and `unsafe-eval` for Tailwind CSS CDN and Alpine.js. Mitigated by: dashboard is behind Basic auth, not public-facing.

## What This Service Does NOT Protect Against

- **Prompt injection**: SheLLM does not inspect prompt content. A pattern-based guard was removed in 2026-09 because it blocked ordinary coding prompts while missing real injections; isolating what the CLI can reach is the defense that works.
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
- `LOG_LEVEL=debug` in production emits a startup warning (may expose sensitive data)
