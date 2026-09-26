# ADR-0005 — The model catalog is read from the CLIs, not maintained by hand

- **Status:** accepted
- **Date:** 2026-09-20
- **Amended by:** [ADR-0009](0009-model-limits-manifest.md), which adds a hand-kept limits
  manifest and makes `GET /v1/models` read this catalog.
- **Amends:** ADR-0001's provider behaviour. It does not touch the credential rules in
  [`IDENTITY.md`](../IDENTITY.md) decision 1, which are what closed the obvious alternative.

## Context

SheLLM advertised five model names: four for claude and, for codex, only `codex`. That one did not
work. With no `-m` the CLI reads `~/.codex/config.toml`, and a ChatGPT account answers
`The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account` to what it usually
finds there. So the single codex entry in `GET /v1/models` was the one that could not run — an SDK
pointed at SheLLM that reads the catalog and uses what it finds fails on the first try, which is
the one promise this project makes.

Hardcoding a longer list is the obvious fix and the wrong one. `gpt-5.5` retires on 2026-10-14;
`gpt-5.4` already stopped working. A list in the repo goes stale silently, and a catalog that is
confidently wrong is worse than a short one.

**The provider APIs cannot answer this.** Both have a models endpoint and both need an API key.
SheLLM holds none by design, and getting one would mean either paying for API credit the project
does not otherwise use or extracting the subscription's OAuth token — the thing decision 1 exists
to forbid. Even with a key the answer would be wrong: an API key's catalog is the API's, and the
CLI runs on a subscription. `gpt-5.4` is exactly that gap.

**Neither CLI documents a way to list models**, but both can be made to:

- `codex app-server` speaks newline-delimited JSON-RPC over stdio. After an `initialize`, its
  `model/list` returns the models **this account** may run, each with a description, an
  `isDefault`, and an `upgradeInfo` carrying a retirement date.
- `claude -p '/model'` prints its current model and one `Available:` line of aliases. `/model` is
  answered by the CLI itself rather than by the API.

Measured 2026-09-20 in the dev container, `codex` 0.154.0 and `claude` 2.1.273
([`benchmarks.md`](../guides/benchmarks.md)): every model both catalogs offer answers a one-word
prompt, and fourteen such calls move codex's 300-minute rate-limit window from 1 % to 3 %. The
metadata reads are lost inside that — **asking what exists is effectively free; finding out
whether it answers is what costs.**

## Decision

The catalog is read at runtime, from the binaries, with two fallbacks under it. Every answer
carries which of the three produced it.

| Source | When |
|---|---|
| `cli` | the installed binaries answered. Cached for `SHELLM_MODEL_CATALOG_TTL_MS`, six hours by default |
| `baked` | the probe failed; `src/catalog/models.json` answered |
| `declared` | no catalog at all, only the hardcoded tier aliases |

`src/catalog/models.json` is generated in the dev container by `npm run catalog:build`, stamped
with the date and the CLI versions it was built against, and committed. It is a **floor, never the
source of truth**: the host runs its own binaries under its own account, so a live probe always
wins. It is committed rather than built on the server for two reasons — a model retiring then
appears as a deleted line in a pull request, and the file loads synchronously, so resolving a bare
provider name costs no spawn on the request path.

Tier aliases stay hardcoded as the last floor. `haiku`, `sonnet` and `opus` are Anthropic's
permanent vocabulary; they are safe to hardcode for exactly the reason version strings are not.

SheLLM invents no names of its own. A caller writes `<provider>-<the CLI's own name>`, and a name
the catalog does not recognise is passed through untouched rather than rejected, so the catalog is
a list of what is known to work and never a whitelist.

## Consequences

- **This depends on two surfaces neither provider promises.** `codex app-server` is marked
  `[experimental]` by its own `--help`, and claude's alias list is a help string written for
  humans. Either can change in a patch release. The fallback chain is what makes that survivable:
  a probe that breaks degrades to the baked file and says so, rather than to an empty catalog or
  a crash.
- **Retire this ADR the day either provider ships a documented listing**, whether a CLI subcommand
  or a subscription-scoped endpoint. The mechanism here exists because there is none, not because
  it is good.
- The catalog has one consumer: the admin dashboard's playground. It suggests and it warns; it
  does not restrict what the field accepts, and it is not on the request path.
- `GET /v1/models` still returns the declared names only. Making a public, OpenAI-compatible
  endpoint depend on one host's probe history is a separate decision and has not been taken.
- Bare `codex` now resolves through the baked catalog, so a host whose catalog was never generated
  keeps today's behaviour — no `-m`, and the config default's failure — rather than a new one.

## What this does not decide

`account/rateLimits/read` on the same app server reports codex's real used-percentage and reset
times for both its windows. `stats.js` currently states that *"Neither CLI reports remaining quota
or a reset time"*, and for codex that is now false. Replacing the derived Capacity panel with
measured quota is worth more than this ADR and is deliberately left out of it.

## What did not change

The binaries are still official and unmodified, driven by documented flags and their own protocol.
No API key, no OAuth token read, no credential leaves the CLI. One process per request stands.
