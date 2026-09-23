# Contributing to SheLLM

## Getting Started

### Prerequisites

- Node.js >= 24
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
# The devcontainer installs all CLI tools automatically
# After opening, verify:
claude --version
codex --version
```

> **Note:** The devcontainer is for development only. In production, SheLLM runs directly on a VPS via systemd (see `scripts/setup/vps.sh`).

## Code Conventions

### Language & Style

- **CommonJS** — `require()` / `module.exports` (no ESM)
- **Semicolons** — yes
- **Single quotes** — for strings
- **2 spaces** — for indentation
- **Trailing commas** — in multi-line objects and arrays
- **No TypeScript** — plain JavaScript with clear naming

### Architecture Rules

1. **Minimal dependencies** (Express, dotenv, better-sqlite3). Don't add packages unless you can justify why a Node.js built-in won't work.
2. **One file per provider.** Each provider is a self-contained module with the same export shape.
3. **No classes.** Providers export plain objects with functions. No inheritance, no `this` binding issues.
4. **Errors are objects, not strings.** Every error response has `{ error, message, request_id }`.
5. **No silent failures.** If something fails, it returns a structured error with an actionable message.

### Provider Contract

Every provider in `src/providers/` must export:

```javascript
module.exports = {
  name: 'provider-name',
  // Names that map to a real CLI model. GET /v1/models lists exactly these, and any
  // id starting with "provider-name-" routes here and is passed to the CLI as given.
  models: ['provider-name', 'provider-name-fast'],
  chat: async ({ prompt, system, response_format, model }) => {
    return { content: '...', cost_usd: null, usage: null };
  },
  chatStream: async function* ({ prompt, system, model, signal }) {
    yield { type: 'delta', content: '...' };
    yield { type: 'done' };
  },
  buildArgs: (params) => ['--flag', params.prompt],
  parseOutput: (stdout) => ({ content: stdout }),
};
```

`chatStream` is optional — without it, streaming requests buffer the `chat()` result and flush it
as one chunk. `buildArgs` and `parseOutput` are exported so they can be tested as pure functions
against recorded CLI output.

## Adding a New Provider

1. Create `src/providers/<name>.js` following the contract above
2. Register the engine in `src/routing/engines.js`
3. Add it to the provider list in `src/infra/health.js` and a migration that inserts its row
4. Write tests in `test/providers/<name>.test.js`, and add it to the CLI contract suite
   (`test/cli/contract.cli.js`) so an upstream flag change is caught
5. Record the CLI version you tested against in `VERSIONS.md`
6. Check the provider's terms first: SheLLM only drives official binaries with the owner's own
   subscription, and the README's fair-use table says what that means per provider

For CLI-based providers, use `execute()` from `src/providers/base.js`:

```javascript
const { execute } = require('./base');

async function chat({ prompt, system, max_tokens }) {
  const args = buildArgs({ prompt, system, max_tokens });
  const result = await execute('cli-command', args);
  return parseOutput(result.stdout);
}
```

Every CLI runs in a temporary working directory with a minimal environment: only `PATH`, `HOME`,
`TMPDIR`, `NO_COLOR` and whatever the provider explicitly passes. A provider's own credential is
the only configured value it may receive.

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
- Tests should be fast and deterministic: no network calls, no timers, no real CLI in CI

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

## Testing Before Deployment

`npm run smoke` runs the end-to-end check against a server you already started — the closest thing
to "does this actually work" short of deploying. `shellm help` lists the CLI; daemon mode is
`shellm start -d`, then `shellm status`, `shellm logs -n 20`, `shellm stop`. `npm unlink -g shellm`
undoes the link.

**`scripts/setup/vps.sh` cannot be rehearsed in a container.** It is `set -euo pipefail` and calls
`systemctl daemon-reload` at line 90, so a stock `ubuntu:22.04` image dies there — after creating
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

Append `!` to the type or add a `BREAKING CHANGE:` footer. Triggers a **major** bump:

```
feat!: rename /v1/complete to /v1/chat/completions

BREAKING CHANGE: the old endpoint path is removed
```

### Examples

```
feat(providers): add Mistral CLI provider

fix(queue): prevent double-resolution when subprocess times out

docs(contributing): add conventional commits section

chore(deps): bump @openai/codex to 0.155.1

refactor(router): extract queue logic into separate module
```

### Scopes (optional but recommended)

`providers`, `router`, `queue`, `auth`, `admin`, `cli`, `health`, `deps`, `ci`, `docs`

### Release flow

Releases are cut by CI from a dispatch; nothing pushes to `master` or tags by hand. The four
steps, and why the workflow deliberately stops short of opening the pull request itself, are in
[`docs/guides/releasing.md`](docs/guides/releasing.md).

What matters while you are writing the commit: a change that breaks an existing install only
reaches **Breaking Changes** if the commit was written `type!:`. A missed marker is fixed on the
release branch, not after publication.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a brief description of what changed and why
- If the PR changes the API contract, document the change
- All tests must pass before merging
