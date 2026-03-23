# Prompt Safety Guide

How SheLLM protects against prompt injection and subprocess abuse — what we do, why we do it, and what we explicitly chose not to do.

---

## The Problem

SheLLM receives prompts via HTTP and passes them to LLM CLI tools (Claude Code, Gemini CLI, Codex CLI) as child processes. These CLI tools can read files, write files, and execute commands on the host. A malicious prompt could instruct the LLM to:

- Read sensitive files (`/etc/passwd`, environment variables, auth tokens)
- Modify system files (`.bashrc`, crontabs, other projects' code)
- Exfiltrate data by encoding secrets into the response
- Cause denial of service (infinite loops, disk fill, memory exhaustion)

**No single defense stops all of these.** Our approach is defense in depth — multiple independent layers, each reducing the attack surface.

---

## Defense Layers

### Layer 1: Input Sanitization

**File:** `src/middleware/sanitize.js`

Every prompt passes through sanitization before reaching any provider:

1. **NFKC Unicode normalization** — converts fullwidth characters, compatibility forms, and ligatures to their canonical equivalents. This prevents attackers from writing `\uFF53\uFF55\uFF44\uFF4F` (fullwidth "sudo") to bypass pattern matching.

2. **Zero-width character stripping** — removes invisible Unicode characters (U+200B zero-width space, U+FEFF BOM, U+00AD soft hyphen, etc.) that attackers insert into keywords to split them across detection boundaries.

3. **Null byte stripping** — prevents injection in C-based CLI parsers.

4. **Carriage return normalization** — prevents log injection attacks.

5. **Length limit** — prompts exceeding 50,000 characters are rejected (validation layer).

### Layer 2: Prompt Injection Detection

**File:** `src/middleware/prompt-guard.js`

A two-tier pattern-based detection system that runs after sanitization:

**Tier 1 — High-confidence patterns (blocks immediately):**
- Shell command execution (`sudo`, `rm -rf`, `chmod`, `systemctl`)
- Sensitive file access (`/etc/passwd`, `~/.ssh`, `/proc/`)
- Environment exfiltration (`print environment variables`, `show API_KEY`)
- Code execution directives (`execute shell command`, `eval code`)
- Network exfiltration (`curl https://...`, `wget`, `netcat`)
- Role/instruction override (`ignore previous instructions`)
- System prompt leak (`reveal the system prompt`)
- File write attempts (`write to file`, `modify /etc/`)

**Tier 2 — Heuristic patterns (blocks when 2+ match):**
- Base64/encoding tricks
- Unicode obfuscation
- Social engineering ("developer mode", "I am the admin")
- Fake delimiters (`--- END SYSTEM ---`, `<system>`)
- Markdown image injection

**Why regex and not ML?** We evaluated several ML-based prompt injection libraries (see "Alternatives Considered" below). We chose pattern-based detection because:

- **Zero dependencies** — no ONNX runtime, no Python sidecar, no external API
- **Deterministic** — same input always produces same result, easy to test and debug
- **Sub-millisecond** — no inference latency
- **Transparent** — every block includes which patterns triggered, making false positives easy to diagnose

The trade-off: a motivated attacker can bypass regex patterns. This is a known limitation documented in our security policy.

### Layer 3: Per-Client Safety Profiles

**File:** `src/middleware/auth.js`, `src/middleware/sanitize.js`

Not all traffic has the same risk profile. Internal batch jobs from trusted systems have lower injection risk than prompts that originate from end users. Instead of a global on/off switch, each API client has a `safety_level`:

| Level | Tier 1 | Tier 2 threshold | Header | Use case |
|---|---|---|---|---|
| `strict` | Blocks | 2 patterns | `X-SheLLM-Safety: full` | Default. External/untrusted input. |
| `standard` | Blocks | 3 patterns | `X-SheLLM-Safety: standard` | Semi-trusted internal input. |
| `permissive` | Skipped | Skipped | `X-SheLLM-Safety: reduced` | Fully trusted batch jobs only. |

Every `permissive` request is logged with a `WARN` event (`prompt_guard_bypassed`) so that misuse is observable. The `X-SheLLM-Safety` response header tells consumers whether their request was screened.

Set via the Admin API:
```
PATCH /admin/keys/:id
{ "safety_level": "standard" }
```

### Layer 4: Environment Isolation

**File:** `src/providers/base.js`

CLI subprocesses do **not** inherit the parent's environment. Instead, each process receives a minimal allowlist:

```
PATH=/usr/local/bin:/usr/bin:/bin
HOME=<user home>
TMPDIR=/tmp
NO_COLOR=1
+ provider-specific vars only (e.g., XDG_CONFIG_HOME for auth)
```

Secrets like `SHELLM_ADMIN_PASSWORD` and `CEREBRAS_API_KEY` never reach CLI subprocesses. The admin password is additionally deleted from `process.env` after being read into a closure at startup.

### Layer 5: Subprocess Safety

**File:** `src/providers/base.js`

Every CLI invocation is constrained:

- **No shell interpolation** — arguments passed as arrays to `spawn()`, not strings
- **Stdin disabled** — `stdio: ['ignore', ...]` prevents interactive prompts
- **Timeout enforcement** — default 120s, kills with SIGTERM then SIGKILL
- **Process group kill** — subprocesses run detached; timeout kills the entire process tree (including grandchild processes spawned by the CLI)
- **Output truncation** — max 1MB per stream prevents memory exhaustion
- **Output sanitization** — ANSI escape codes and control characters stripped from responses

### Layer 6: Container Hardening

**Files:** `Dockerfile`, `docker-compose.yml`

The Docker container provides the outer security perimeter:

- **Non-root user** — runs as `node`, not root
- **Read-only filesystem** — `read_only: true` with tmpfs for `/tmp` and data directories
- **Loopback binding** — `127.0.0.1:6100` only, never exposed to network
- **Resource limits** — 768MB memory, 1 CPU core
- **Version-pinned CLIs** — Gemini and Codex installed via npm with locked versions
- **Auth volume isolation** — CLI credentials mounted as separate Docker volumes

### Layer 7: Observability

Every security-relevant event is logged as structured JSON:

| Event | Level | When |
|---|---|---|
| `prompt_blocked` | warn | Prompt injection pattern detected |
| `prompt_guard_bypassed` | warn | Permissive client skips guard |
| `prompt_guard_disabled` | warn | Guard globally disabled at startup |
| `auth_failure_spike` | warn | 10+ auth failures in 1 minute |
| `admin_auth_failure` | warn | Failed admin login attempt |
| `admin_auth_blocked` | warn | Brute-force lockout triggered |
| `cerebras_api_error` | error | Provider error (body redacted) |

Auth failure spikes and provider transitions fire webhooks to `SHELLM_ALERT_WEBHOOK_URL` (Slack, Discord, etc.).

---

## What We Explicitly Do NOT Protect Against

Being honest about limitations is better than false confidence:

- **Sophisticated prompt injection** — our detection is pattern-based. An attacker who understands our regex can craft prompts that bypass it. This is inherent to regex-based approaches. The safety profiles exist so operators can tune the risk/usability trade-off per client.

- **PII in prompts** — SheLLM does not scan for personal data. Callers (e.g., Stockerly) must anonymize data before sending. This is a design decision, not a gap — PII detection belongs at the application layer, not the bridge.

- **Claude CLI tool use** — when `--dangerously-skip-permissions` is enabled (default, required for non-interactive mode), Claude can execute tools without confirmation. Container-level controls (read-only filesystem, non-root user) are the compensating control. This can be disabled via `SHELLM_CLAUDE_SKIP_PERMISSIONS=false`, but it may break non-interactive operation.

- **CLI vulnerabilities** — if Claude Code, Gemini CLI, or Codex CLI have security bugs, SheLLM inherits them. Keep CLI tools updated.

---

## Alternatives We Evaluated

During our research phase, we evaluated the full landscape of prompt injection prevention tools. Here's why we chose our current approach over the alternatives:

| Tool | Why we didn't use it |
|---|---|
| **Defender (StackOneHQ)** | Best Node.js option with ML (ONNX model). Adds 22MB dependency + ONNX runtime. We opted for zero-dependency patterns first; Defender remains our top candidate if we add ML detection later. |
| **LLM Guard (Protect AI)** | Python-only. Would require a sidecar service, adding deployment complexity and latency. |
| **NeMo Guardrails (NVIDIA)** | Heavyweight framework with Colang DSL. Designed for full LLM application flows, overkill for a bridge service. |
| **Lakera Guard** | SaaS API dependency. Adds external latency, availability risk, and cost. Conflicts with our minimal-dependency philosophy. |
| **bubblewrap (bwrap)** | Evaluated for per-invocation subprocess sandboxing. Strong candidate for a future phase — would wrap each CLI call in a filesystem namespace. Currently deferred because Docker read-only + non-root user provides adequate outer perimeter. |

Our pattern-based approach was validated against real-world attack vectors including DAN jailbreaks, instruction overrides, nested prompt injection, environment exfiltration, and reverse shell attempts. Test coverage includes 45+ prompt injection test cases.

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SHELLM_PROMPT_GUARD` | `true` | Enable prompt injection detection. Set to `DISABLED_UNSAFE` to disable in production, `false` for development only. |
| `SHELLM_CLAUDE_SKIP_PERMISSIONS` | `true` | Pass `--dangerously-skip-permissions` to Claude CLI. Set to `false` to require permissions (may break non-interactive mode). |
| `SHELLM_REQUIRE_AUTH` | `true` | Reject all requests when no API keys exist. Set to `false` for unauthenticated development. |
| `SHELLM_ALERT_WEBHOOK_URL` | (none) | Webhook URL for security event alerts. |
| `SHELLM_AUTH_ALERT_THRESHOLD` | `10` | Auth failures per minute before firing a webhook alert. |

---

## FAQ

**Q: Can an attacker bypass the prompt guard?**

Yes. Pattern-based detection is bypassable by design. It catches common and naive attacks — the kind most likely to come from automated tools or untargeted abuse. A skilled attacker who studies the regex can craft bypasses. This is why we have multiple layers: even if the prompt guard is bypassed, the subprocess runs in an isolated environment with no access to secrets and a read-only filesystem.

**Q: Why not use an ML model for detection?**

We prioritized zero dependencies, deterministic behavior, and sub-millisecond latency. ML models add 10-200ms latency, 20-50MB dependencies, and non-deterministic results that are harder to debug. Our current approach provides fast first-pass protection. If we add ML detection in the future, `@stackone/defender` is our top candidate — it runs entirely in-process with a bundled ONNX model.

**Q: Should I set all my clients to `permissive`?**

No. Use `permissive` only for clients that send fully trusted input from your own systems (e.g., automated batch jobs where prompts are generated by your code, not by end users). For anything that touches user-generated content, use `strict`.

**Q: What happens when a prompt is blocked?**

The request returns HTTP 400 with `{ "error": "prompt_rejected" }`. The response does not reveal which patterns triggered (to avoid helping attackers refine their prompts). The blocked event is logged internally with full pattern details for debugging.

**Q: Is the health endpoint safe to expose?**

`GET /health` returns only `{ "status": "ok" }` — no internal details. The detailed health check (`GET /health/detailed`) requires admin authentication. This split prevents information leakage while still supporting Docker healthchecks and monitoring.

**Q: What if I need to send a prompt that contains "sudo" or "rm -rf" for legitimate reasons?**

If your use case legitimately involves discussing system administration commands (e.g., asking the LLM to explain a bash script), set the client's `safety_level` to `standard` or `permissive`. Alternatively, rephrase the prompt to avoid exact pattern matches — the guard triggers on `sudo` as a command directive, not on discussions about sudo concepts.
