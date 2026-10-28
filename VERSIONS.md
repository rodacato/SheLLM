# SheLLM — CLI Versions Reference

The pins live in [`config/cli-versions/package.json`](config/cli-versions/package.json): that file
is what a host installs and what `shellm doctor` checks against. This page records which
combinations were tested by hand, and how a pin moves. Read it and the tool's changelog before
moving one.

---

## The CLIs

| Tool | Package in the manifest | Installed by `vps.sh` with |
|---|---|---|
| `claude` (Claude Code) | `@anthropic-ai/claude-code` | the official installer, `claude.ai/install.sh`, at the pinned version |
| `codex` | `@openai/codex` | `npm install -g` into the service user's prefix. The adapter was rewritten against 0.154.0 on 2026-09-19, and that version's event output is recorded in `test/fixtures/codex/0.154.0/` |

## Tested Combinations

| SheLLM | claude | codex | Node.js | Last tested |
|---|---|---|---|---|
| after v1.25.0 | 2.1.312 | 0.165.0 | 24.x | 2026-10-28 — `npm run test:cli` and `npm run test:e2e` for both CLIs: OpenAI and Anthropic shapes, streaming, usage, and a 404 for a model the CLI lacks |
| v1.1.1 | 2.1.273 | 0.154.0 | 24.x | 2026-09-19 — `npm run test:cli` for both CLIs; codex `exec --json` output recorded from the real binary; claude stream-json output recorded too |

Each row is the pinned pair on the date it was verified by hand. Between bumps, the **CLI
contract** workflow ([`ci-cli-contract.yml`](.github/workflows/ci-cli-contract.yml)) runs
`npm run test:cli` in two modes: at the pinned versions on every pull request that touches the
providers, the CLI tests or the manifest, and against `@latest` of both CLIs on a weekly schedule.
The weekly run is how an upstream release that drops a flag the adapters pass — a major included,
which Dependabot never proposes — fails before anyone moves the pin.

---

## Known Breakage Points

| Tool | Risk | Impact |
|---|---|---|
| `claude` | High | Unsupported flags or `--print` output changes break `claude.js` |
| `codex` | Medium | `exec --json` event shape changes break `codex.js` |

`shellm doctor --live` sends its one request through claude only, so it is no evidence for a codex
pin. `npm run test:e2e` is.

---

## How to Update a CLI Version

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens one PR per CLI for its newest
patch or minor release past the cooldown, and the CLI contract workflow runs `npm run test:cli` on
that PR at the proposed version. A green PR proves only that the flags are still accepted, not
that the output still parses, so steps 1, 3 and 4 still apply before merging. A major is never
proposed: it moves by hand, the same way.

Codex is still `0.x`, where every release is a minor, so for codex the filter excludes nothing
until `1.0`.

1. Read the tool's changelog for breaking changes to flags, output format, or auth flow.
2. Update the version in `config/cli-versions/package.json` (Dependabot's PR already does).
3. Run `npm run test:cli` to check every flag the providers pass is still accepted, then `npm run test:e2e` with the CLIs logged in to verify output parsing.
4. Add a row to **Tested Combinations** above with the new versions and date.
5. Commit with message: `chore(deps): bump <cli> to x.y.z`.

---

## On a server

How a host installs the pins, keeps them, and moves them on an update is in the
[deployment guide](docs/guides/deployment.md#1-provision). A developer machine usually runs
whatever the CLI updated itself to: if parsing breaks there, compare `claude --version` or
`codex --version` against the manifest and check the provider in `src/providers/` for
assumptions about its output.
