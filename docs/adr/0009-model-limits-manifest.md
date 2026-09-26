# ADR-0009 — Model limits come from a hand-kept manifest, and `/v1/models` reads the catalog

- **Status:** accepted
- **Date:** 2026-09-26
- **Amends:** ADR-0005. It keeps the catalog read from the CLIs and adds a second, hand-kept
  source for what the CLIs do not report. It also takes the `/v1/models` decision ADR-0005 left
  open.

## Context

A client choosing a model needs three things the catalog does not carry: how much it can send
(the context window), how much can come back, and which reasoning efforts it accepts. Knotty and
a site-review run through SheLLM (2026-09-25/26) both sent tens of thousands of tokens and had to
guess.

The CLIs report part of it, for this account:

- `codex app-server` `model/list` gives, per model, `supportedReasoningEfforts`,
  `defaultReasoningEffort` and `inputModalities`. No context window.
- `claude -p /model` lists aliases, and `sonnet[1m]`, `opus[1m]`, `fable[1m]` among them: the
  1M-context variants the account may run. No window sizes, no efforts, no output cap.

ADR-0005 rejected a hand-maintained list because a list of **which models exist** goes stale
silently. That argument does not reach a model's **limits**: a published model's context window
does not change while it is served. What changes is which models exist, and that stays with the
CLIs.

The Anthropic API does not name 1M-context models separately either. A caller sends the same model
with the beta header `anthropic-beta: context-1m-<date>`; the claude binary carries that same
identifier and maps its `[1m]` aliases onto it.

## Decision

**`src/catalog/limits.json` is a manifest kept by hand**, per SheLLM model id: context window,
the 1M window where one exists, output cap, reasoning efforts. It is best effort. Nothing in it is
required, and a model it does not name gets a context window of **200,000** tokens.

**Precedence, per field: `cli` > `manifest` > `default`.** A value the CLI reports wins. Every
limit `/v1/models` returns says which of the three it came from, so a caller can tell a measured
figure from an assumption.

**The manifest is informational. It never rejects or alters a request.** The CLI stays the
validator: an over-long prompt is its own 400 `context_length_exceeded`, which costs nothing and
is exact. A wrong manifest entry misinforms a caller; it cannot break one.

**`GET /v1/models` reads the catalog** of the enabled providers, keeps every id it listed before,
and adds the limits to each entry in its OpenAI shape.

**1M context is requested the way the Anthropic API requests it**: the same model id plus
`anthropic-beta: context-1m-<date>`, on either endpoint (an extension on the OpenAI one). SheLLM
then runs the CLI's `<alias>[1m]`. A model without a 1M variant ignores the header, as the API
does. No new model ids.

## Consequences

- The manifest can be wrong, and says so by design: its entries carry `manifest` as their source.
  It is updated by hand when a model is added, the same way the baked catalog is regenerated.
- `/v1/models` now depends on the catalog probe. The probe is cached for
  `SHELLM_MODEL_CATALOG_TTL_MS` and falls back to the baked file, so a cold read costs one spawn
  and never an empty list.
- A 1M request that the account cannot serve fails in the CLI and surfaces as its error, not as a
  silent downgrade to 200k.

## What this does not decide

Honouring `max_tokens` through `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, and reporting a truncated answer
as `finish_reason: "length"`. Both use the output cap this manifest documents; neither is part of
listing it.

## What did not change

ADR-0005's catalog, its three sources and its TTL. The binaries stay official and unmodified. One
process per request stands.
