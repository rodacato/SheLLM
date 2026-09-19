# SheLLM — CLI Versions Reference

The last known-good version of each upstream CLI. Read this table and the tool's changelog before upgrading one in production.

> **Consult C1 `ines`** ([expert panel](docs/EXPERTS.md)) when any of these versions changes or a provider starts behaving unexpectedly.

---

## Versions

| Tool | Version | Pinned | Notes |
|---|---|:---:|---|
| `claude` (Claude Code) | `2.1.273` | ✅ | `CLAUDE_VERSION` in `scripts/setup/vps.sh`, passed to the official installer |
| `codex` | `0.154.0` | ✅ | `CODEX_VERSION` in `scripts/setup/vps.sh`, installed as the service user from the npm package `@openai/codex`; the devcontainer still installs the latest. The adapter was rewritten against this version on 2026-09-19 and its event output is recorded in `test/fixtures/codex/0.154.0/` |

## Tested Combinations

| SheLLM | claude | codex | Node.js | Last tested |
|---|---|---|---|---|---|
| v0.5.0 | 2.1.273 | 0.154.0 | 24.x | 2026-09-19 — `npm run test:cli` for both CLIs; codex `exec --json` output recorded from the real binary; claude stream-json output recorded too |

---

## Known Breakage Points

| Tool | Risk | Impact | Mitigation |
|---|---|---|---|
| `claude` | High | Unsupported flags or `--print` output changes break `claude.js` | Bump `CLAUDE_VERSION` in `vps.sh` only after `npm run test:cli` and `shellm doctor --live` pass on the new version |
| `codex` | Medium | `exec --json` event shape changes break `codex.js` | Bump `CODEX_VERSION` in `vps.sh` only after `npm run test:cli` and `shellm doctor --live` pass on the new version. The weekly `npm run test:cli` run tests the latest release, so drift shows up before the pin moves |

---

## How to Update a CLI Version

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update `CLAUDE_VERSION` or `CODEX_VERSION` in `scripts/setup/vps.sh`.
3. Run `npm run test:cli` to check every flag the providers pass is still accepted, then `npm run test:e2e` with the CLIs logged in to verify output parsing.
4. Update the **Tested Combinations** table above with the new version and date.
5. Commit with message: `chore(deps): bump <cli> to x.y.z`.

---

## Upgrading a CLI on a server

`vps.sh` passes `CLAUDE_VERSION` to the official installer and installs `@openai/codex` at
`CODEX_VERSION`, so a server stays on the versions in the table until you bump them. A developer
machine usually runs whatever the CLI updated itself to: if parsing breaks there, compare
`claude --version` or `codex --version` against the table and check the provider in
`src/providers/` for assumptions about its output.
