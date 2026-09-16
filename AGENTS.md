# SheLLM — AI Agent Instructions

## Context

SheLLM is a Node.js/Express service that drives official LLM CLI tools (Claude Code, Gemini CLI,
Codex CLI) and OpenAI-compatible HTTP providers behind one REST API that speaks both the OpenAI
(`/v1/chat/completions`) and Anthropic (`/v1/messages`) formats. It keeps client keys, settings
and request logs in SQLite, ships an admin dashboard and a `shellm` CLI, and runs on a VPS under
systemd behind cloudflared.

## Local instructions

`CLAUDE.local.md` is personal: never committed, and every agent reads it at session start when it
exists.

## Your role

Read these three at session start. They are short on purpose.

- **[`docs/IDENTITY.md`](docs/IDENTITY.md)** — who you are here, always on: north star,
  load-bearing decisions, anti-pattern commitments, decision framework.
- **[`docs/AUDIENCE.md`](docs/AUDIENCE.md)** — who SheLLM is for and explicitly not for. A
  proposal nobody there needs is not built.
- **[`docs/EXPERTS.md`](docs/EXPERTS.md)** — the panel, consulted on demand: when asked for
  debate, a trade-off or a second opinion, when an expert is named, or when you are genuinely
  unsure about a non-trivial call. Two to four voices, 2–4 lines each, then one recommendation
  with its risks and fallback. **Experts advise; IDENTITY decides.**

## Work tracking

Planned work — features, bugs, debt, findings, open decisions — lives in the maintainer's
**private GitHub Project**, never in a markdown file. Items stay drafts; nothing is promoted to a
public issue, because the repo is public and handles subscription credentials. Report security
problems as `SECURITY.md` describes, never in a public issue.

## Design

Visual design follows the Pencil method in [`design/README.md`](design/README.md): the code is the
source of truth, copy is never invented, and disagreements between design and code are logged in
`design/DECISIONS.md` instead of silently fixed.

## Project conventions

### Code style

- CommonJS (`require`/`module.exports`), no TypeScript, no ESM, no build step
- Semicolons, single quotes, 2-space indentation, trailing commas in multi-line literals
- Comments only where the *why* isn't self-evident

### Structure

[`docs/guides/architecture.md`](docs/guides/architecture.md) is the map: directory layout,
request flow, provider and error contracts. Keep it current when you move a module rather than
copying a tree into another doc.

### Adding a new provider

1. Create `src/providers/<name>.js` following the provider contract in the architecture guide
2. Register it in `src/routing/engines.js`
3. Add its health check entry (see `src/infra/health.js`)
4. Add tests in `test/providers/<name>.test.js`
5. Record the CLI version it was tested with in `VERSIONS.md`

### Testing

- Node.js built-in test runner (`npm test`)
- Mock subprocess calls at the `execute()` boundary
- API tests use the Express app directly (no `server.listen` in tests)

## Boundaries

- **No PII.** Anonymization happens in the caller. If a prompt looks like it carries personal
  data, flag it.
- **Official, unmodified CLI binaries only.** Never extract OAuth tokens, call provider endpoints
  with a subscription's credentials, or disguise the client. Don't suggest it as a speedup.
- **One subscription owner.** No multi-tenant mode and no sharing of a subscription with other
  people.
- **Network exposure is not settled in code.** The server currently binds every interface; don't
  describe it as loopback-only until the bind address is fixed.

## Git workflow

- Conventional commits: `type(scope): description` (e.g. `fix(admin): ...`, `feat(providers): ...`)
- Each commit is a coherent working state — PRs are rebase-merged, so every commit lands as written
- Keep branches linear: rebase onto `master`, never merge `master` in
- No `Co-Authored-By` trailers or any AI attribution

## What not to do

- Don't add TypeScript, ESM or a build step
- Don't add an ORM or a second datastore — SQLite through `better-sqlite3` is the persistence layer
- Don't add a framework on top of Express (no Nest, no Fastify migration)
- Don't add auth mechanisms beyond the existing client keys and admin auth
- Don't reopen a decision in the `ROADMAP.md` decision log without an ADR
