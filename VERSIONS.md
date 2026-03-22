# SheLLM — CLI Versions Reference

This file tracks the last known-good version of each upstream CLI tool tested with SheLLM. Before upgrading a CLI in production or in the Dockerfile, check this table and read the tool's changelog.

> **Activate Compat (S1)** when any of these versions changes or a provider starts behaving unexpectedly.

---

## Pinned Versions (Dockerfile)

| Tool | Version | Pinned | Notes |
|---|---|:---:|---|
| `@google/gemini-cli` | `0.30.0` | ✅ | Pinned via `ARG GEMINI_CLI_VERSION` in Dockerfile |
| `@openai/codex` | `0.105.0` | ✅ | Pinned via `ARG CODEX_CLI_VERSION` in Dockerfile |
| `claude` (Claude Code) | latest | ❌ | Installed via `curl \| bash` — no version pin |

## Tested Combinations

| SheLLM | claude | gemini-cli | codex | Node.js | Last tested |
|---|---|---|---|---|---|
| v0.1.0 | unknown | 0.30.0 | 0.105.0 | 22.x | 2026-02-27 |

---

## Known Breakage Points

| Tool | Risk | Impact | Mitigation |
|---|---|---|---|
| `claude` | High — no version pin | Auth flow or `--print` flag changes break `claude.js` | Pin version in Dockerfile once stable release tag is available |
| `gemini-cli` | Medium — pinned | Output format changes in minor versions | Read CHANGELOG before bumping `GEMINI_CLI_VERSION` |
| `codex` | Medium — pinned | `--quiet` flag or JSON output format changes | Read CHANGELOG before bumping `CODEX_CLI_VERSION` |

---

## How to Update a CLI Version

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update the version in `Dockerfile` (`ARG *_CLI_VERSION`).
3. Run `npm run smoke` against a local Docker build to verify provider output parsing still works.
4. Update the **Tested Combinations** table above with the new version and date.
5. Commit with message: `chore(deps): bump gemini-cli to x.y.z`.

---

## Upgrading Claude Code

Claude Code has no pinnable version via the install script. When it updates automatically on the host:

1. Check if `claude --version` output changed.
2. Run `npm run smoke` to verify provider health.
3. If parsing breaks, check `src/providers/claude.js` for assumptions about stdout format.
