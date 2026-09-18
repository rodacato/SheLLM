# SheLLM — CLI Versions Reference

This file tracks the last known-good version of each upstream CLI tool tested with SheLLM. Before upgrading a CLI in production or in the Dockerfile, check this table and read the tool's changelog.

> **Consult C1 `ines`** ([expert panel](docs/EXPERTS.md)) when any of these versions changes or a provider starts behaving unexpectedly.

---

## Pinned Versions (Dockerfile)

| Tool | Version | Pinned | Notes |
|---|---|:---:|---|
| `@openai/codex` | `0.154.0` | ✅ | Pinned via `ARG CODEX_CLI_VERSION` in Dockerfile |
| `claude` (Claude Code) | `2.1.273` | ✅ | `CLAUDE_VERSION` in `scripts/setup/vps.sh`, passed to the official installer |

## Tested Combinations

| SheLLM | claude | codex | Node.js | Last tested |
|---|---|---|---|---|---|
| v0.5.0 | 2.1.273 | 0.154.0 | 24.x | 2026-09-16 — CLI flags only (`npm run test:cli`); output formats not yet run through `npm run test:e2e` |

---

## Known Breakage Points

| Tool | Risk | Impact | Mitigation |
|---|---|---|---|
| `claude` | High | Unsupported flags or `--print` output changes break `claude.js` | Bump `CLAUDE_VERSION` in `vps.sh` only after `npm run test:cli` and `shellm doctor --live` pass on the new version |
| `codex` | Medium — pinned in Docker, latest on the VPS | `exec --json` event shape changes | `npm run test:cli` weekly; e2e before bumping `CODEX_CLI_VERSION` |

---

## How to Update a CLI Version

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update the version in `Dockerfile` (`ARG *_CLI_VERSION`).
3. Run `npm run test:cli` to check every flag the providers pass is still accepted, then `npm run test:e2e` with the CLIs logged in to verify output parsing.
4. Update the **Tested Combinations** table above with the new version and date.
5. Commit with message: `chore(deps): bump <cli> to x.y.z`.

---

## Upgrading Claude Code

Claude Code has no pinnable version via the install script. When it updates automatically on the host:

1. Check if `claude --version` output changed.
2. Run `npm run smoke` to verify provider health.
3. If parsing breaks, check `src/providers/claude.js` for assumptions about stdout format.
