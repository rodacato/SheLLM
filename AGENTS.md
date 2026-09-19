# SheLLM — AI Agent Instructions

## Context

SheLLM drives official LLM CLI binaries (Claude Code, Codex) behind one REST API that speaks both
the OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) formats. It keeps client keys
and request logs in SQLite, reads its configuration from `~/.config/shellm/env`, ships a small
admin dashboard and a `shellm` CLI, and runs on a VPS under systemd as its own user.

## Local instructions

`CLAUDE.local.md` is personal: never committed, and every agent reads it at session start when it
exists.

## Your role

Read these three at session start. They are short on purpose.

- **[`docs/IDENTITY.md`](docs/IDENTITY.md)** — who you are here, always on: north star,
  load-bearing decisions, anti-pattern commitments.
- **[`docs/AUDIENCE.md`](docs/AUDIENCE.md)** — who SheLLM is for and explicitly not for. A
  proposal nobody there needs is not built.
- **[`docs/EXPERTS.md`](docs/EXPERTS.md)** — the panel, consulted on demand: when asked for
  debate, a trade-off or a second opinion, when an expert is named, or when you are genuinely
  unsure about a non-trivial call. Two to four voices, 2–4 lines each, then one recommendation
  with its risks and fallback. **Experts advise; IDENTITY decides.**

Decisions already taken live in [`docs/adr/`](docs/adr/); ADR-0001 is the baseline.

## Work tracking

Planned work lives in the maintainer's **private GitHub Project**, never in a markdown file. Items
stay drafts; nothing is promoted to a public issue, because the repo is public and handles
subscription credentials. Report security problems as `SECURITY.md` describes.

## Design

Visual design follows the Pencil method in [`design/README.md`](design/README.md): the code is the
source of truth, copy is never invented, and disagreements between design and code are logged in
`design/DECISIONS.md` instead of silently fixed.

## Project conventions

- CommonJS, no TypeScript, no ESM, no build step.
- Semicolons, single quotes, 2-space indentation, trailing commas in multi-line literals.
- Comments only where the *why* isn't self-evident.
- [`docs/guides/architecture.md`](docs/guides/architecture.md) is the map: directory layout,
  request flow, provider and error contracts. Update it when you move a module instead of copying
  a tree into another doc.

**Adding a provider:** `src/providers/<name>.js` following the contract in the architecture guide,
registered in `src/routing/engines.js`, exporting an `authProbe` that costs no quota, tests
in `test/providers/`, and the CLI version it was tested against in `VERSIONS.md`. Export a
`models` array of the names that map to a real CLI model — `/v1/models` lists exactly that.

**Tests:** `npm test` (Node's runner). Prefer the real thing: temp directories, real function
calls, and a fake CLI written to disk and put on `PATH` over mocking `execute()`. `base.js`
captures `PATH` when it loads, so a test that installs a fake CLI must do it before requiring any
provider. API tests use the Express app directly.

## Boundaries

- **Official, unmodified CLI binaries only.** Never extract OAuth tokens, call provider endpoints
  with a subscription's credentials, or disguise the client. Not as a speedup either.
- **One subscription owner**, their own applications. No multi-tenant mode, no sharing.
- **SheLLM never inspects prompt content.** No classifying, filtering or flagging what callers
  send. What the CLI can reach is the boundary that matters.
- **Human scale.** No automatic retries when a provider reports a usage limit, a concurrency cap
  by default, and health checks that spend no quota.
- **Secrets stay out of the checkout** and out of the CLI environment; `CLAUDE_CODE_OAUTH_TOKEN`
  is the one value claude receives.

## Git workflow

- Conventional commits: `type(scope): description`.
- Each commit is a coherent working state — PRs are rebase-merged, so every commit lands as written.
- Keep branches linear: rebase onto `master`, never merge `master` in.
- No `Co-Authored-By` trailers or any AI attribution.

## What not to do

- Don't add TypeScript, ESM or a build step.
- Don't add an ORM or a second datastore. SQLite holds data; configuration is the config file.
- Don't add a framework on top of Express.
- Don't add auth mechanisms beyond client keys and admin auth.
- Don't reopen an ADR without writing the next one.
