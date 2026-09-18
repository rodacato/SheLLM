# SheLLM — CLI Versions Reference

The last known-good version of each upstream CLI. Read this table and the tool's changelog before upgrading one in production.

> **Consult C1 `ines`** ([expert panel](docs/EXPERTS.md)) when any of these versions changes or a provider starts behaving unexpectedly.

---

## Versions

| Tool | Version | Pinned | Notes |
|---|---|:---:|---|
| `claude` (Claude Code) | `2.1.273` | ✅ | `CLAUDE_VERSION` in `scripts/setup/vps.sh`, passed to the official installer |
| `codex` | `0.154.0` | ❌ | Not installed by `vps.sh`; the devcontainer installs the latest. Upstream is ahead, and the adapter is rewritten against the current CLI in phase 1b |

## Tested Combinations

| SheLLM | claude | codex | Node.js | Last tested |
|---|---|---|---|---|---|
| v0.5.0 | 2.1.273 | 0.154.0 | 24.x | 2026-09-16 — CLI flags only (`npm run test:cli`); output formats not yet run through `npm run test:e2e` |

---

## Known Breakage Points

| Tool | Risk | Impact | Mitigation |
|---|---|---|---|
| `claude` | High | Unsupported flags or `--print` output changes break `claude.js` | Bump `CLAUDE_VERSION` in `vps.sh` only after `npm run test:cli` and `shellm doctor --live` pass on the new version |
| `codex` | Medium — unpinned | `exec --json` event shape changes | `npm run test:cli` weekly; pin it in `vps.sh` when the adapter is rewritten |

---

## How to Update a CLI Version

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update `CLAUDE_VERSION` in `scripts/setup/vps.sh`.
3. Run `npm run test:cli` to check every flag the providers pass is still accepted, then `npm run test:e2e` with the CLIs logged in to verify output parsing.
4. Update the **Tested Combinations** table above with the new version and date.
5. Commit with message: `chore(deps): bump <cli> to x.y.z`.

---

## Upgrading Claude Code

`vps.sh` passes `CLAUDE_VERSION` to the official installer, so a server stays on the version in the
table until you bump it. A developer machine usually runs whatever the CLI updated itself to: if
parsing breaks there, compare `claude --version` against the table and check
`src/providers/claude.js` for assumptions about stdout.
