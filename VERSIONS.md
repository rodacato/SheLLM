# SheLLM — CLI Versions Reference

The last known-good version of each upstream CLI. Read this table and the tool's changelog before upgrading one in production.

> **Consult C1 `ines`** ([expert panel](docs/EXPERTS.md)) when any of these versions changes or a provider starts behaving unexpectedly.

---

## Versions

| Tool | Version | Pinned | Notes |
|---|---|:---:|---|
| `claude` (Claude Code) | `2.1.273` | ✅ | `@anthropic-ai/claude-code` in `config/cli-versions/package.json`; `vps.sh` passes it to the official installer |
| `codex` | `0.154.0` | ✅ | `@openai/codex` in `config/cli-versions/package.json`, installed as the service user from the npm package `@openai/codex`. The adapter was rewritten against this version on 2026-09-19 and its event output is recorded in `test/fixtures/codex/0.154.0/` |

## Tested Combinations

| SheLLM | claude | codex | Node.js | Last tested |
|---|---|---|---|---|
| v1.1.1 | 2.1.273 | 0.154.0 | 24.x | 2026-09-19 — `npm run test:cli` for both CLIs; codex `exec --json` output recorded from the real binary; claude stream-json output recorded too |

This row records the pinned pair at the date it was verified by hand. What keeps it honest between
bumps is the **CLI contract** workflow, which runs `npm run test:cli` against `@latest` of both CLIs
every Monday — so an upstream release that drops a flag the adapters pass fails there before the
pin moves.

---

## Known Breakage Points

| Tool | Risk | Impact | Mitigation |
|---|---|---|---|
| `claude` | High | Unsupported flags or `--print` output changes break `claude.js` | Move the claude pin only after `npm run test:cli` and `shellm doctor --live` pass on the new version |
| `codex` | Medium | `exec --json` event shape changes break `codex.js` | Move the codex pin only after `npm run test:cli` and `shellm doctor --live` pass on the new version. The weekly `npm run test:cli` run tests the latest release, so drift shows up before the pin moves |

---

## How to Update a CLI Version

Each week Dependabot opens one PR per CLI, to its newest patch or minor release that is at least
seven days old, and the CLI contract workflow runs `npm run test:cli` on that PR at the proposed
version. A green PR proves
only that the flags are still accepted, not that the output still parses, so steps 1, 3 and 4 still
apply before merging. A major is never proposed: it moves by hand, the same way.

Codex is still `0.x`, where every release is a minor, so for codex the filter excludes nothing
until `1.0`.

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update the version in `config/cli-versions/package.json`.
3. Run `npm run test:cli` to check every flag the providers pass is still accepted, then `npm run test:e2e` with the CLIs logged in to verify output parsing.
4. Update the **Tested Combinations** table above with the new version and date.
5. Commit with message: `chore(deps): bump <cli> to x.y.z`.

---

## Upgrading a CLI on a server

`vps.sh` installs both CLIs at the versions the checked-out release pins, and turns off Claude
Code's autoupdater for the service user, so a server stays on the versions in the table until you
bump them. A host that updates to a release with a new pin installs it as part of the update, and
puts the previous one back if the update rolls back. `shellm doctor` warns when an installed CLI
differs from its pin. `CLAUDE_VERSION` and
`CODEX_VERSION` override the pin for one run of `vps.sh`. A developer
machine usually runs whatever the CLI updated itself to: if parsing breaks there, compare
`claude --version` or `codex --version` against the table and check the provider in
`src/providers/` for assumptions about its output.
