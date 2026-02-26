# Security Policy

## Architecture

SheLLM is designed as an **internal service**. It is not intended to be exposed to the public internet.

### Network Isolation

- The service binds to `127.0.0.1` (loopback) in production — only accessible from the same host
- When using Docker networking, the service is accessible only from containers on the same bridge network
- **No TLS termination** is performed by SheLLM — this is the responsibility of the reverse proxy (if any)
- **No authentication middleware** — network isolation is the trust boundary

### Auth Token Handling

SheLLM manages auth tokens for three CLI tools. These tokens are **equivalent to API keys** and must be treated accordingly.

| Provider | Token Location | Persistence |
|---|---|---|
| Claude Code | `~/.claude/` | Docker volume |
| Gemini CLI | `~/.config/gemini/` | Docker volume |
| Codex CLI | `~/.codex/` | Docker volume |
| Cerebras | `CEREBRAS_API_KEY` env var | Environment |

**Rules:**

- Auth token directories are mounted as Docker volumes — never committed to version control
- `.gitignore` excludes auth directories
- Volume backups (if any) must be encrypted
- Auth tokens should be rotated by re-running `docker exec -it shellm <cli> auth login`

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
- **Rate limiting abuse**: SheLLM has a basic queue (max concurrent + max depth) but no per-client rate limiting. It trusts the caller.
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

## Container Security

- The service runs as a **non-root user** (`node`) inside the container
- The Dockerfile uses `node:22-slim` (minimal attack surface)
- CLI tools are installed at build time — no runtime downloads
- Resource limits (memory, CPU) are enforced via Docker/Kamal configuration
