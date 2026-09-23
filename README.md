<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/logo-light.svg">
    <img alt="SheLLM" src="assets/logo/logo-dark.svg" width="400">
  </picture>
</p>

<p align="center"><em>Your LLM subscription — as a REST API for your own apps.</em></p>

<p align="center">
  <a href="https://github.com/rodacato/SheLLM/actions/workflows/ci.yml"><img src="https://github.com/rodacato/SheLLM/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rodacato/SheLLM/releases/latest"><img src="https://img.shields.io/github/v/release/rodacato/SheLLM" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://rodacato.github.io/SheLLM/api/">API reference</a> ·
  <a href="docs/guides/usage.md">Calling it from your code</a> ·
  <a href="docs/guides/deployment.md">Running it on a server</a>
</p>

You pay for Claude Code or Codex. Your own apps cannot use that subscription — they need API
credit you would buy separately. SheLLM runs the official CLI you already have, behind one HTTP
endpoint that answers in both the OpenAI and the Anthropic formats, so an official SDK pointed at
it works on the first try.

## What it is not

- **Not a way to share a subscription.** One owner, their own applications. No multi-tenant mode,
  no reselling capacity.
- **Not a backend for coding agents.** Claude Code, Cline, Aider and friends drive their own CLI;
  putting SheLLM in between adds latency and breaks their terms. Use it from software you wrote.
- **Not an API-key gateway.** If you pay per token, LiteLLM and OpenRouter do that better.
- **Not machine-scale.** Subscription quota is measured in human sessions, not throughput.

It does not work with Gemini (see below), with local runtimes like Ollama, or with any provider
that has no official CLI you can log into.

## Fair use and provider terms

SheLLM runs the **official, unmodified CLI binaries** and nothing else. It never extracts OAuth
tokens, never calls a provider's API with subscription credentials, and never pretends to be a
different client. If a change would make SheLLM faster by leaving the official binary, the answer
is no.

Running your own subscription through your own software still carries risk, and it is yours:

| Provider | Status |
|---|---|
| **Claude** (Claude Code) | Supported. Anthropic's terms forbid intermediating Claude.ai credentials; SheLLM spawns the official binary, which keeps its own login. |
| **Codex** (ChatGPT Plus/Pro/Business) | Supported, at your own risk. OpenAI documents `codex exec` for scripts and CI but recommends API keys for automation. No terms clause forbids wrapping your own subscription; anti-abuse classifiers are the real exposure, and a suspension takes the whole ChatGPT account with it. |
| **Gemini** | Not supported. Gemini CLI stopped serving personal plans on 2026-06-18, and Antigravity's terms forbid "using the Service in connection with products not provided by us". |

Keep it human-scale. SheLLM never retries a request on its own, caps concurrent CLI processes
(`MAX_CONCURRENT`, default 4) and probes provider health with `--version`, which spends no quota.
Cross-provider fallback is off unless you turn it on. What is left to you: one login per provider,
and not pointing a batch job at it. If you need machine-scale volume, buy API access — that is
what it is for.

## What you'd build with it

You already pay the subscription, so the marginal request costs nothing extra — and for Claude the
CLI reports what that request *would* have cost on the API, attributed to the key that made it.
Build the feature, run it for a week, and you know the bill before you decide to pay one. Codex
reports no cost, so its requests read `not priced`.

Three shapes, one integration — an official SDK with the base URL and the key swapped:

```mermaid
graph LR
    A[Chat handler] -->|SDK| S
    B[Nightly job] -->|SDK| S
    C[Script or Playground] -->|SDK| S
    S[SheLLM] --> CLI[claude / codex]
    S -.->|per key: requests, tokens, cost| D[(Dashboard)]
```

**A chatbot or an assistant inside your app.** Someone is waiting, so latency is the constraint:
the floor for any answer is about 2.5 s ([benchmarks](docs/guides/benchmarks.md)) and four requests
run at a time by default. Fine for one person talking to your app; not a support queue.

**A nightly report over your own data.** A cron job that reads yesterday's rows and leaves a
summary you find in the morning. **One report, not one per row** — pushing a backlog through a
subscription is what gets accounts flagged, and it is the same boundary as "not machine-scale"
above.

**Trying a prompt or a model before it becomes a feature.** The playground sends a real request
down the same path your app takes, and the same key then works from a shell script. Give each
experiment its own key and the dashboard answers which of them is worth paying for.

## Getting started

Requires Node.js 24 and a logged-in `claude` (or `codex`) on the same machine.

```bash
git clone https://github.com/rodacato/SheLLM.git && cd SheLLM
npm install && npm link    # dependencies and the shellm command
shellm init                # config file, Claude token, first API key, checks
shellm start
```

`shellm init` asks for the token from `claude setup-token` — press Enter to skip it if `claude` is
already logged in for your user — writes `~/.config/shellm/env` with mode 600, prints your first
API key once, writes the load limits so they are values you can see rather than defaults you have
to read the source for, and runs the checks. `shellm doctor` repeats them later; `shellm doctor --live`
sends one real request.

Then, with the key it printed:

```bash
export SHELLM_KEY=shellm-...   # the key init printed, shown once

curl http://127.0.0.1:6100/v1/chat/completions \
  -H "Authorization: Bearer $SHELLM_KEY" -H "Content-Type: application/json" \
  -d '{"model": "claude-haiku", "messages": [{"role": "user", "content": "Hello"}]}'
```

Official SDKs need no code change:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:6100/v1 OPENAI_API_KEY=$SHELLM_KEY
export ANTHROPIC_BASE_URL=http://127.0.0.1:6100 ANTHROPIC_API_KEY=$SHELLM_KEY
```

Those two lines are on the dashboard's API Keys page with your own address filled in, and with the
key filled in too on the one screen that ever shows it.

For a server, [`docs/guides/deployment.md`](docs/guides/deployment.md) covers
`scripts/setup/vps.sh`, the systemd unit and logging a CLI in on a headless machine. Two commands
matter once it is running: `shellm update` moves the host to the newest published release and
rolls back on its own if the service does not come up, and `shellm backup` writes a consistent
snapshot of the database and the config file for whatever you already use to carry backups off a
host.

To call it from your own code — SDK snippets, what Claude can and cannot do through the API, the
limits you will hit — read [`docs/guides/usage.md`](docs/guides/usage.md).

## The dashboard

`/admin` is where the keys, the request log and provider health live. Browsers sign in at
`/admin/login` — any username unless `SHELLM_ADMIN_USER` is set, with the password `shellm init`
printed; scripts use HTTP Basic with the same `SHELLM_ADMIN_PASSWORD`. Over HTTPS it installs as
an app: its own window and icon, and a warm start. Not an offline dashboard — every number on it
comes from the gateway ([ADR-0007](docs/adr/0007-installed-dashboard-is-a-launcher.md)).

![Request logs — a filterable table of every request with its status, client, provider, model, duration, tokens and cost, one row expanded to show the request id and the upstream detail, and an error-rate sparkline below it](design/exports/admin-request-logs-default.png)

Every request is logged with what it cost and how long the CLI took, so "which app is burning the
subscription" is a question with an answer. Nothing about the prompt is stored or inspected.

![API Keys — a freshly created key shown once in full above the two SDK export lines with the key already in them, each with a copy button, and below them a card stating the base URL and the same two lines written against $SHELLM_KEY](design/exports/admin-api-keys-key-created.png)

A key is shown once and never again, so the page shows it beside the two lines that use it — the
OpenAI base URL carries `/v1`, the Anthropic one must not. The card below states the base URL and
the same two lines against `$SHELLM_KEY`, which is what a key created months ago still needs.

![Playground — a client key field, a format selector set to Anthropic /v1/messages, a model field, a prompt box, and a response panel showing a 200 with round trip, token counts and request id](design/exports/admin-playground-answered.png)

The playground sends a real request through the same path an app takes, so a key that works here
works everywhere.

<sub>Renders from the [design system](design/README.md), which mirrors the shipped code.</sub>

## Models

| Provider | Models |
|---|---|
| Claude | `claude` (the CLI's default), `claude-haiku`, `claude-sonnet`, `claude-opus`, and any other `claude-*` id the CLI accepts, passed through as `--model` |
| Codex | `codex` (the CLI's configured default) and any `codex-<model>` id, passed through as `-m <model>` — for example `codex-gpt-5.6-sol`. The CLI runs `--ephemeral` and `-s read-only`, one process at a time |

A model the CLI rejects comes back as `404 model_not_found`.

## API

| Endpoint | Notes |
|---|---|
| `POST /v1/chat/completions` | OpenAI format. `model` and `messages` required, `max_tokens` optional (1–128000) |
| `POST /v1/messages` | Anthropic format. `model`, `max_tokens` and `messages` required, top-level `system` optional |
| `GET /v1/models` | OpenAI model list of the names that map to a real CLI model |
| `GET /health` | `{ "status": "ok" }`, unauthenticated |
| `/admin/*` | Keys, request logs and provider status — see [The dashboard](#the-dashboard) |

The full contract — request and response schemas, the admin endpoints, streaming — is the
OpenAPI document in [`docs/api/openapi.yaml`](docs/api/openapi.yaml). A running instance serves
the bundled version of it at `/docs/openapi.json`, and `npm run docs:preview` opens it as a page.

Requests to `/v1/*` need `Authorization: Bearer <key>` or `x-api-key`. Errors come back in the
format of the endpoint you called:

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad input |
| 401 | `auth_required` | Missing or invalid key |
| 404 | `model_not_found` | The CLI does not know that model |
| 429 | `rate_limited` | Too many requests, with `Retry-After` |
| 502 | `cli_failed` | The CLI exited with an error |
| 503 | `provider_unavailable` | Provider disabled, not authenticated, or circuit open |
| 504 | `timeout` | Killed after `TIMEOUT_MS` |

## CLI

```
shellm init                    Create the config file and a first API key
shellm doctor [--live]         Check the setup; --live sends one real request
shellm start [-d] [-p PORT]    Start the server (foreground or daemon)
shellm stop | restart          Control the daemon
shellm status                  Report whether the server answers
shellm logs [-f] [-n N]        View daemon logs
shellm backup [--dir DIR]      Snapshot the database and config file into one directory
shellm update | version        Update the install, print the version
```

## How it works

```mermaid
graph LR
    App -->|HTTP| Auth[Auth + rate limit]
    Auth --> Queue[Request queue]
    Queue --> Router
    Router --> Claude[claude CLI]
    Router --> Codex[codex CLI]
    Router -.->|--version| Health[Health poller]
    Auth -.->|request log| SQLite[(SQLite)]
```

Each request spawns a CLI process in its own temporary directory and discards it, so nothing leaks
between requests — about 0.9 s of process startup, inside a floor of roughly 2.5 s for the whole
short answer, measured on a production server in
[`docs/guides/benchmarks.md`](docs/guides/benchmarks.md). Configuration lives in
`~/.config/shellm/env`; SQLite holds keys, request logs and the audit trail. [`docs/guides/architecture.md`](docs/guides/architecture.md) has the module
map and [`docs/adr/`](docs/adr/) the decisions.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, conventions, tests and adding a provider. Release
history is in [CHANGELOG.md](CHANGELOG.md).

Found a security problem? Do not open an issue — report it through
[the private advisory form](https://github.com/rodacato/SheLLM/security/advisories/new).
[SECURITY.md](SECURITY.md) has the scope, the threat model and the disclosure timeline.

## License

[MIT](LICENSE)
