# Contributing to SheLLM

## Getting Started

### Prerequisites

- Node.js at the version `engines` names in [`package.json`](package.json)
- Access to at least one CLI tool (Claude Code or Codex CLI)
- Docker (optional — only for the devcontainer)

### Development Setup

```bash
git clone https://github.com/rodacato/SheLLM.git && cd SheLLM
npm install
npm link                   # puts `shellm` on PATH; or call `node src/cli.js` directly

shellm init                # config file, first API key, admin password, checks
npm run dev                # starts on :6100 and restarts on changes

npm test
```

`shellm init` is not optional. Without it there is no config file, so every `/v1/*` request
answers `401 auth_required` and every `/admin/*` route answers `501 admin_disabled`. It prints the
API key and the admin password once — that is the only time either is shown.

Four scripts worth knowing:

| Command | What it does |
|---|---|
| `npm run seed` | Three demo keys and a synthetic request log, so the dashboard has something to render |
| `npm run smoke` | End-to-end check against a running server |
| `npm run migrate` | Applies pending SQL migrations |
| `npm run catalog:build` | Rebuilds the baked model catalog from the CLIs |

`npm install` also sets `core.hooksPath` to `scripts/`, which installs the pre-commit hook that
lints and scans staged changes for secrets.

### Using the Dev Container

The project includes a devcontainer configuration for local development. Open in VS Code with the Dev Containers extension. How credentials reach the container and what survives a rebuild is in [`.devcontainer/README.md`](.devcontainer/README.md).

```bash
# The devcontainer does not install the provider CLIs: bring claude and codex
# (installed and logged in) with your own tooling, then verify:
claude --version
codex --version
```

> **Note:** The devcontainer is for development only. In production, SheLLM runs directly on a VPS via systemd (see `scripts/setup/vps.sh`).

## Code Conventions

### Language & Style

- **English only, everywhere in the repo**: product copy (dashboard, landing, brand page, social
  card), code, comments, docs, commits and the `.pen` designs. One locale, never a mix.
- **CommonJS** — `require()` / `module.exports`. No ESM, no TypeScript, no build step.
- Semicolons, single quotes, 2-space indentation, trailing commas in multi-line literals.
- Comments only where the *why* isn't self-evident.

### Architecture Rules

1. **Few dependencies.** The list is in [`package.json`](package.json); justify any addition
   against the Node.js built-in that would otherwise do the job.
2. **One file per provider**, exporting a plain object with the shape in the
   [architecture guide](docs/guides/architecture.md#providers). Adding one is covered there too.
3. **No ORM and no second datastore.** SQLite holds data; configuration is the config file.
4. **No framework on top of Express**, and no auth mechanism beyond client keys and admin auth.
5. **Errors are built with the factories in `src/errors.js`**, never as strings; the response
   shape depends on the path ([error shapes](docs/guides/architecture.md#error-shapes)).
6. **No silent failures.** A failure returns a structured error with an actionable message.
7. **Decisions already taken live in [`docs/adr/`](docs/adr/).** Reopening one means writing the
   next ADR.

### Adding a setting

One entry in [`src/config/schema.js`](src/config/schema.js) — `default`, `since` (the release you
are adding it in), `reload`, `describe` — then `npm run config:build` and commit the regenerated
`.env.example`. Read it with `config.get('NAME')`, never `process.env.NAME || 'default'`; the
default belongs in the schema and CI fails when the generated file is stale. Keep the read where it
is: a module-level `const` stays `restart`, a read inside a function stays `live`. See
[ADR-0008](docs/adr/0008-configuration-schema-in-code.md).

## Testing

### Running Tests

```bash
# All tests
npm test

# Specific test file
node --test test/providers/claude.test.js
```

### Test Guidelines

- Use Node.js built-in test runner (`node:test`)
- Prefer the real thing: temp directories, real function calls, and a fake CLI written to disk and
  put on `PATH` over mocking `execute()`. `base.js` captures `PATH` when it loads, so a test that
  installs a fake CLI must do it before requiring any provider
- API tests import the Express `app` directly — don't start a server
- `npm test` is fast and deterministic: no network calls, no timers, no real CLI
- The real binaries are exercised separately: `npm run test:cli` checks every argument the
  adapters pass (no login needed; the CLI contract workflow runs it at the pinned versions on PRs
  that touch a provider or a pin, and weekly against the latest releases), and `npm run test:e2e` checks real output and needs both
  CLIs logged in

### Coverage

`npm run test:coverage` writes `coverage/lcov.info` and reports against a minimum. CI runs it on
every pull request, and it warns rather than failing — set `COVERAGE_BLOCKING` to `true` in
`.github/workflows/ci.yml` to make a drop block a merge.

The figure only counts files a test loads. The dashboard's browser scripts run through
`vm.runInContext`, which Node's coverage does not instrument, so they are exercised and still
absent from the number.

### The API contract

The OpenAPI document lives in [`docs/api/`](docs/api/), split one file per path and schema with
[`docs/api/openapi.yaml`](docs/api/openapi.yaml) as the root.

```bash
npm run docs:lint     # validate against the recommended ruleset
npm run docs:build    # rebuild docs/api/bundled.json — commit it
npm run docs:preview  # open it as a page
```

`test/api/spec-coverage.test.js` walks the real Express router and fails when a route is not in the
bundle, so adding an endpoint means adding its path file and re-running `docs:build`. A route that
is deliberately not part of the API — the dashboard's own pages, the PWA files — goes in that
test's `NOT_AN_API_SURFACE` map with the reason.

### Conformance with the first-party APIs

`test/sdk/` checks SheLLM against fixtures we wrote; [`test/conformance/`](test/conformance/README.md)
checks it against what Anthropic and OpenAI actually return. Each case is recorded once from the
real API with your own key (`npm run conformance:record`, cents per run), and `npm test` then
compares SheLLM's response with the recording offline, so CI needs no key and makes no network
call. `npm run conformance:report` lists every difference to fix or accept. Re-record before a
release or after an SDK bump.

## Testing Before Deployment

`npm run smoke` runs the end-to-end check against a server you already started — the closest thing
to "does this actually work" short of deploying. `shellm help` lists the CLI; daemon mode is
`shellm start -d`, then `shellm status`, `shellm logs -n 20`, `shellm stop`. `npm unlink -g shellm`
undoes the link.

**`scripts/setup/vps.sh` cannot be rehearsed in a container.** It is `set -euo pipefail` and calls
`systemctl daemon-reload`, so a stock `ubuntu:22.04` image dies there — after creating
a user and installing Node. Test it on a disposable VPS, or read
[`docs/guides/deployment.md`](docs/guides/deployment.md), which documents what it does step by
step. It does not configure cloudflared; the tunnel is a separate manual step.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). The format is machine-readable and drives the automated CHANGELOG and GitHub Releases.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | When to use | Version bump |
|---|---|---|
| `feat` | New feature or capability | minor |
| `fix` | Bug fix | patch |
| `docs` | Documentation only | — |
| `chore` | Deps, tooling, CI, config | — |
| `refactor` | Code restructure, no behavior change | — |
| `test` | Test additions or fixes | — |
| `perf` | Performance improvement | patch |

### Breaking changes

Append `!` to the type. The changelog reads only the subject, so a `BREAKING CHANGE:` footer alone
is not seen; the version bump itself is chosen by hand when the release is cut:

```
feat!: rename /v1/complete to /v1/chat/completions
```

### Examples

```
feat(messages): accept a system prompt as content blocks

fix(queue): prevent double-resolution when subprocess times out

docs(contributing): add conventional commits section

chore(deps): bump @openai/codex to 0.155.1

refactor(routing): extract queue logic into separate module
```

### Scopes (optional but recommended)

The area the change touches, the way `git log` already names it: a provider (`claude`, `codex`),
an endpoint (`messages`), a dashboard area (`admin`, `keys`), or `deps`, `ci`, `docs`.

### Release flow

Releases are cut by CI from a dispatch; nothing pushes to `master` or tags by hand. The four
steps, and why the workflow deliberately stops short of opening the pull request itself, are in
[`docs/guides/releasing.md`](docs/guides/releasing.md).

What matters while you are writing the commit: a change that breaks an existing install only
reaches **Breaking Changes** if the commit was written `type!:`. A missed marker is fixed on the
release branch, not after publication.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- PRs are rebase-merged, so every commit lands as written: each one must be a coherent working state
- Keep the branch linear: rebase onto `master`, never merge `master` in
- Include a brief description of what changed and why
- If the PR changes the API contract, document the change
- All tests must pass before merging
