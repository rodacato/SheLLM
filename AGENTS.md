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

Planned work lives on a **private board**, never in a markdown file. An item becomes an **issue in
this repo when work on it starts** — so the open issues are what is actually being worked on, not a
backlog. A short list is the intended state.

Two things stay off the issue tracker until they are fixed: anything with a security impact, and
anything that would describe a live weakness in a service that handles subscription credentials.
Report security problems as `SECURITY.md` describes.

A pull request closes its issue with `Closes #<n>`.

## Design

Visual design follows the Pencil method in [`design/README.md`](design/README.md): the code is the
source of truth, copy is never invented, and disagreements between design and code are logged in
`design/DECISIONS.md` instead of silently fixed.

Brand sources and the brand guide live in [`design/brand/`](design/brand/README.md). Edit the
sources there and run `npm run brand:build`; never hand-edit the exports or their runtime copies.

## Conventions

Before your first edit, read [`CONTRIBUTING.md`](CONTRIBUTING.md): it is the home of the style
rules (English only, CommonJS, no build step), the architecture rules, adding a setting, tests,
commit messages and pull requests. [`docs/guides/architecture.md`](docs/guides/architecture.md)
is the map: what each area does, request flow, the provider contract and adding a provider. Update
it when you move a module instead of copying a tree into another doc.

## Boundaries

- **Official, unmodified CLI binaries only.** Never extract OAuth tokens, call provider endpoints
  with a subscription's credentials, or disguise the client. Not as a speedup either.
- **One subscription owner**, their own applications. No multi-tenant mode, no sharing.
- **SheLLM never inspects prompt content.** No classifying, filtering or flagging what callers
  send. What the CLI can reach is the boundary that matters.
- **Human scale.** No automatic retries when a provider reports a usage limit, a concurrency cap
  by default, and health checks that spend no quota.
- **Secrets stay out of the checkout** and out of the CLI environment; `CLAUDE_CODE_OAUTH_TOKEN`
  is the one secret claude receives, and codex receives none.

## Git workflow

- Conventional commits, rebase-merged, linear branches: the rules are in `CONTRIBUTING.md`.
- No `Co-Authored-By` trailers or any AI attribution.
