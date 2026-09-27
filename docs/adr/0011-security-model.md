# ADR-0011 — The security model is the floor that ships today, and the rest waits for tools

- **Status:** accepted
- **Date:** 2026-09-27
- **Covers:** the isolation flags of commit `816c785` (`--disable-slash-commands`,
  `--strict-mcp-config`, `--settings '{"disableAllHooks":true}'`) and the codex sandbox and
  serialization of commit `57178ac` (`-s read-only`, one process at a time). Both were decided in
  commits with no record of their own; this ADR is that record.
- **Builds on:** [ADR-0002](./0002-cli-internal-tools-off.md) (tools off) and
  [ADR-0006](./0006-spawn-per-request-stays.md) (one process per request). Neither is amended.

## Context

SheLLM's security model was being decided one commit at a time. Each commit was right on its own,
but the set was written down nowhere, so nobody could say what a served request is prevented from
doing, what enforces it, or which gaps are known and accepted.

The revamp also sketched a stronger design for the day the CLI's tools come back: root-owned Claude
Code managed settings, the CLI's own sandbox, network egress rules in the unit, a second OS user.
Every piece of it needs a spike on the VPS, and none of it buys anything while tools are off. This
ADR records the floor that exists and names the trigger for the rest, rather than designing a
system nobody runs yet.

## Decision

### The floor

Every protection below ships today. A row without an enforcing file is not part of the floor.

| Protection | Enforced by | Where |
|---|---|---|
| The claude CLI's own tools are off (ADR-0002) | `--tools ''`, `--permission-mode dontAsk` | `src/providers/claude.js:34-40` |
| Slash commands, MCP servers from `~/.claude.json` and hooks never run | `--disable-slash-commands`, `--strict-mcp-config`, `--settings '{"disableAllHooks":true}'` | `src/providers/claude.js:34-40` |
| Codex cannot write | `exec -s read-only --ephemeral` | `src/providers/codex.js:88` |
| Never two codex processes at once (they corrupt the OAuth refresh, openai/codex#17340) | a mutex around `chat`, `chatStream` and the health probe | `src/providers/codex.js:15-26` |
| A request starts in its own directory, outside the checkout, holding only that request's files, removed when the CLI exits | `mkdtemp` per request as `cwd`, request files at mode `0600`, `rm` on `close` | `src/providers/base.js:37-64` |
| Nothing the caller wrote reaches argv | the prompt goes to stdin, the system prompt and schema to files in that directory; `spawn` with an argument array, no shell | `src/providers/base.js:52-70`, `src/providers/claude.js:81-117`, `src/providers/codex.js:93-98` |
| SheLLM's own secrets never reach the CLI | an allowlisted environment: `PATH`, `HOME`, `TMPDIR`, `NO_COLOR`, `NODE_EXTRA_CA_CERTS`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and for claude only `CLAUDE_CODE_OAUTH_TOKEN`. Everything else — `SHELLM_ADMIN_PASSWORD`, `SHELLM_HMAC_SECRET`, `SHELLM_AUTH_TOKENS`, provider API keys — is absent | `src/providers/base.js:17-32`, `src/providers/claude.js:219-225`, `src/providers/codex.js:6-9` |
| The admin password is not even in the service's own environment after boot | read once, then `delete process.env.SHELLM_ADMIN_PASSWORD` | `src/middleware/admin-auth.js:70-76` |
| A runaway CLI and its children die | timeout, `SIGTERM` then `SIGKILL` to the whole process group (`detached: true`) | `src/providers/base.js:58`, `src/providers/base.js:89-126` |
| The service runs unprivileged and cannot gain privileges | `User=shellmer`, `NoNewPrivileges=yes` | `shellm.service:7`, `shellm.service:28` |
| The service and every CLI it spawns cannot write the system or the code they run | `ProtectSystem=strict`, `ReadOnlyPaths=/home/shellmer/shellm` | `shellm.service:19`, `shellm.service:26` |
| `/tmp` is private to the service | `PrivateTmp=yes` | `shellm.service:27` |
| An admin session cannot be forged from the password alone | cookie signed with HMAC-SHA256 under a key derived from the key-hashing secret, `HttpOnly`, `SameSite=Lax`, `Secure` behind TLS, scoped to `/admin`, 7 days | `src/middleware/admin-session.js:13-26`, `src/middleware/admin-session.js:74-84` |
| A cross-site form cannot use that session | a cookie-authenticated write is refused unless `Sec-Fetch-Site` is `same-origin` | `src/middleware/admin-session.js:92-96`, `src/middleware/admin-auth.js:130-133` |
| A stolen database does not yield client keys | keys stored as HMAC-SHA256 under a server-side secret | `src/db/clients.js:14-40` |

The floor is proven on what the CLI receives, not on the flag list.
`test/providers/cli-env-secrets.test.js` puts a fake `claude` and `codex` on `PATH`, serves a
request through each provider module, and asserts on what the fake recorded: the claude argv
carries tools off, slash commands off, strict MCP and hooks disabled; codex runs `-s read-only`;
each request starts in a new directory outside the checkout that holds only that request's files;
and no key from `.env.example` except claude's own token is in the child's environment.
`test/providers/codex-concurrency.test.js` proves the serialization, and `npm run test:cli`
(`test/cli/contract.cli.js`) proves the pinned binaries accept every flag set.

### Accepted risks

Each is theoretical while the CLIs have no tools, and each becomes real the day they do.

- **The CLI entrypoints live in a writable home.** The unit grants `ReadWritePaths=/home/shellmer`
  because the CLIs keep state there, and `PATH` resolves `claude` and `codex` from
  `~/.local/bin` and `~/.npm-global/bin`. Anything running as `shellmer` can replace the binary
  the next request starts. The sandbox confines the checkout, not the entrypoints.
- **Every claude process shares `~/.claude.json` and `~/.claude/`.** There is no per-request home.
  `--strict-mcp-config` and the hooks setting stop that file from contributing code; they do not
  stop one process from reading what another wrote.
- **The subscription token is in the service's environment.** `CLAUDE_CODE_OAUTH_TOKEN` is loaded
  from the config file into the Node process and handed to claude on purpose. It is readable by
  anything running as `shellmer`, through `/proc/<pid>/environ` or the config file itself.
- **The CLI runs as the same OS user that owns SheLLM's secrets on disk.** The environment is
  scrubbed; the disk is not. `~/.config/shellm/env` (admin password, HMAC secret) and
  `~/.shellm/shellm.db` (key hashes, the generated HMAC secret) are readable by the user the CLI
  runs as. Only the absence of tools keeps a request from them.
- **`--dangerously-skip-permissions` is on by default.** With tools off there is nothing for it to
  authorize; `SHELLM_CLAUDE_SKIP_PERMISSIONS=false` removes it.

### Deferred, and what reopens it

| Deferred | Why not now |
|---|---|
| Root-owned Claude Code managed settings (`/etc/claude-code/managed-settings.json`) that deny reads of the config file, the database and the checkout | Duplicates `--tools ''` today; needs a VPS spike to confirm precedence over the flags |
| The CLI's own sandbox (bubblewrap on Linux) | Sandboxes tool execution, and there is none |
| Network egress restrictions (`IPAddressDeny`/`IPAddressAllow` in the unit, or a proxy) | The CLIs must reach their providers; an allowlist needs measuring which hosts they call |
| A separate OS user for the CLIs, so SheLLM's secrets are not on the same user's disk | Requires moving CLI state and credentials, and a privilege hop in the spawn path |

**Trigger:** the day any endpoint restores a CLI tool — an agentic endpoint, a caller-controlled
tool list — or a projects model lands that gives a request a working directory with real files.
That change supersedes ADR-0002 and must ship with the items above, or with a written reason for
each one it leaves out. It does not ship by flipping a flag in a PR.

## Consequences

- The flags of `816c785` and `57178ac` are covered here. Removing one is a change to this ADR, not
  a refactor, and the test above fails when one goes missing.
- A new setting that is a secret is safe by default: the environment is an allowlist, so it has to
  be added on purpose to reach a CLI. The env test reads `.env.example`, so a new key is covered
  the moment it is documented there.
- The card's original negative case — *a served request cannot read a file the managed settings
  deny* — is not proven, because managed settings do not exist. What is proven is narrower: the CLI
  is started without tools, in a directory holding nothing but the request, with none of SheLLM's
  secrets in its environment. Whether the real binary honours those flags is proven only by the
  contract suite accepting them and by ADR-0002's measurement, not by an attack test.
- `SECURITY.md` describes the floor for readers of the repo and points here for the reasoning.
