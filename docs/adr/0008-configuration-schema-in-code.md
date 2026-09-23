# ADR-0008 — Configuration is declared in code, and `.env.example` is generated from it

- **Status:** accepted
- **Date:** 2026-09-23
- **Amends:** nothing. It formalises a file that has been hand-kept since ADR-0001 and adds the
  half `c9409b7` left open.

## Context

`.env.example` is the only reference for what SheLLM can be configured with. Since `c9409b7` it is
also enforced: [`test/docs/env-documented.test.js`](../../test/docs/env-documented.test.js) fails
when `src/` reads a variable the file does not document, and when the file documents one nothing
reads. That gate closed the drift class where a variable existed and no reference mentioned it.

It closed it for **names**. Values were left outside, and the file carries them: `MAX_CONCURRENT=4`
is written in `.env.example` and again as `process.env.MAX_CONCURRENT || '4'` in the code, in 21
such places. Nothing compares the two. The symptom is already in the repository —
`src/middleware/auth.js` opens `getGlobalRpm` with `// Dynamic: reads from DB > env > default (30)`
over a body that reads no database and defaults to `60`. A comment that was true.

The second gap is not drift at all, and it is the one that cost real time. Nothing tells an
**operator** that a release added a setting. `shellm init` writes six keys and is additive, so
re-running it adds nothing new; `shellm update` syncs systemd units and deliberately never touches
`~/.config/shellm/env`; `shellm doctor` checks that the file exists and is mode 600, not what is in
it. `SHELLM_CORS_ORIGINS` shipped in v1.10.0 and the host running v1.10.0 learned about it from a
failed CORS preflight.

Four prior arts were read before choosing:

| Project | Mechanism | Why not it, or what was taken |
|---|---|---|
| [Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/) | ships `defaults.ini`, reads it at runtime; the operator writes only `custom.ini` overrides | the most elegant answer to both gaps, and it means every read goes through a config layer anyway — which is what is adopted, minus the ini file |
| [PostgreSQL](https://www.postgresql.org/docs/current/view-pg-settings.html) | `pg_settings` exposes each parameter with a `source` column: `default`, `configuration file`, … | taken directly. It is the only way to answer "what is in effect and where did it come from" without reading code |
| [Discourse](https://github.com/discourse/discourse/blob/main/config/site_settings.yml) | `site_settings.yml` is the schema; values live in the database and are edited in the admin UI | the schema shape is taken (type, default, `secret:`). Moving values into the database is not — see below |
| [Home Assistant](https://developers.home-assistant.io/docs/core/platform/repairs/) | an issue registry; anything needing human intervention becomes a repair item with `is_fixable` | the idea of a durable "you need to act" surface is taken as one doctor check and one dashboard block, not as a registry |

A file-level version header was considered and rejected: it says the file changed, not which
variable is new, it breaks when a host skips a release, and git already versions the file. `since:`
per variable gives the same answer, survives a skipped release, and costs the same.

## Decision

**`src/config/schema.js` is the single declaration.** One entry per variable carrying its
`default`, the release that introduced it (`since`), whether it applies without a restart
(`reload`), a one-line `describe`, and `secret` for anything that must be scrubbed from output.

**`.env.example` is generated from it** by `npm run config:build` and committed. CI regenerates and
diffs it, the same step `docs/api/bundled.json` has had since `c9409b7`. The file stays the
operator's reference and stops being a thing a human keeps in step.

**Every read goes through `src/config/`.** `config.get(name)` replaces the inline
`process.env.X || 'default'`, so a default exists in exactly one place and the existing test can
gate values as well as names.

**`reload` is a fact about the code, not an aspiration.** SheLLM already has two classes of
variable and has never named them: `allowedOrigins()` re-reads `process.env` on every request
behind a cache keyed on the string, while `REQUIRE_AUTH` is a module-level `const` frozen at
require time. The schema records which is which, because it is what decides whether a change needs
a restart — and any future ability to change a setting at runtime is only correct for the first
kind.

**Two surfaces consume it.** `shellm config` prints the `pg_settings` table — name, value in
effect, source, `since`. `shellm doctor` and the System page report settings absent from the live
config whose `since` is newer than the running version, which is the bounded list; the full "27
settings you have not set" is noise and is only printed on request.

Nothing about what SheLLM does changes. This ADR moves where a default is written, never what it
is, so a host that upgrades behaves exactly as it did.

## Consequences

- **The generator is now load-bearing for a file operators copy from.** A bug in it ships a wrong
  reference to every host. The CI diff is what makes that a failed build rather than a support
  question, and it is the reason the generated file stays committed instead of being built on the
  host.
- **`since` is backfilled from git history**, so it is an archaeological claim about releases
  before this ADR and an authored one after it. A variable whose introduction cannot be placed in a
  release gets `v1.0.0` as a floor rather than a guess.
- **A new variable now costs a schema entry**, and adding one without it fails the suite. That is
  the point, and it is also the tax: the schema must not grow a field nothing reads.
- The existing bidirectional name gate does not go away. It is rewritten against the schema, which
  strictly widens what it catches.

## What this does not decide

**Editing configuration from the dashboard.** The server can write `~/.config/shellm/env` —
`shellm.service` grants `ReadWritePaths=/home/shellmer` — but it cannot restart itself, because
`Restart=on-failure` does not restart a clean exit. A UI that writes settings would therefore
report "restart required" for everything except the `reload: live` ones, and that is a design worth
taking on its own evidence, not as a rider here. The schema is what makes it possible later.

**Moving values into the database.** Discourse's model is the right one for a forum with many
admins. SheLLM has one operator with SSH access, and a config file that survives a database restore
independently of the database is a property worth keeping until something argues otherwise.

**Type validation at boot.** The schema records a type, and nothing yet rejects
`MAX_CONCURRENT=banana` at startup. `envalid`-style fail-fast is a natural next step and is not
taken here.

## What did not change

`~/.config/shellm/env` is still the live configuration, still written by `shellm init`, still mode
600, and still the only file that holds secrets. `.env.example` is still read at runtime by nothing
but the dev container's first-run copy. No variable was renamed, removed, or given a new default.
