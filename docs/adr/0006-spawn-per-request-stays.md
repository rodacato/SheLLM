# ADR-0006 — Spawn-per-request stays; the warm pool is dropped

- **Status:** accepted
- **Date:** 2026-09-21
- **Supersedes:** decision 4 of [`docs/IDENTITY.md`](../IDENTITY.md), "Latency is fixed by keeping
  processes warm, not by leaving the CLI"
- **Amends:** [ADR-0001](./0001-baseline.md) — its consequence "a warm pool is the planned fix and
  is gated on measuring it on the server first" is answered here: it was measured, and the answer
  is no. Its constraint "one CLI process per request, discarded after" is unchanged and is now the
  decision rather than a condition on a future pool

## Context

SheLLM starts one `claude` process per request and discards it. Decision 4 named the warm pool as
the fix for the ~2 s that costs, with one condition attached to it: *"one process per request,
discarded after, so context never leaks between requests."* Isolation was written into the
decision, not bolted on afterwards, and anti-pattern commitment 5 required proving it before
building on it.

A spike on the production VPS on 2026-09-21 tried to prove exactly that, against `claude` 2.1.273.
[`docs/guides/benchmarks.md`](../guides/benchmarks.md) has the full run.

### A warm process cannot be re-targeted, and it remembers

One process was spawned with `--model haiku` and a system prompt naming it ALPHA. Its second turn
carried `model: "sonnet"` and a BETA system prompt in the envelope:

| What turn 2 tried to change | What happened |
|---|---|
| Model → `sonnet` | Ignored. `init` and every `assistant` event still reported `claude-haiku-4-5-20251001` |
| System prompt → BETA | Ignored. The reply still opened with `ALPHA` |
| Nothing — history | **Leaked.** Turn 2 answered with a word given only in turn 1 |

**All three fields were accepted without an error and ignored.** A harness that checked only for
errors would have reported a working re-target. The CLI documents the middle row:
`--system-prompt-snapshot` defaults to on, records the prompt on the conversation's first request,
and replays it verbatim afterwards "even when a later launch passes different text".

### The structural reason, which outlives the measurement

`pingdotgg/t3code` drives the same binary with warm processes and does not hit this, because a
warm process there is **bound to one conversation and never round-robined**. That is what makes it
safe: the state that persists belongs to the caller it persists for.

SheLLM has no conversation identity. `/v1/chat/completions` and `/v1/messages` are stateless — the
caller sends the whole history every time, and two requests from the same client are not related.
There is nothing to bind a warm process to, so any pool here hands an anonymous request to
whichever process is free, which is the leak above by construction.

This is the load-bearing argument. Were the CLI to ship a reset tomorrow, SheLLM would still be
the wrong shape for a pool.

### And the prize was smaller than recorded

| | Median | Range |
|---|---|---|
| spawn → `init` | 514 ms | 494–538 ms |
| spawn → first result (cold) | 1.68 s | 1.59–1.79 s |
| second turn, same process (warm) | 0.78 s | 0.75–0.84 s |
| **what a pool would remove** | **0.90 s** | |

Decision 4 cited "roughly 2.2 s of every answer is process startup", derived by subtracting network
from a 2.5 s end-to-end floor. Measured at the process it is about **0.9 s**; the rest of that
floor is generation and protocol, which a pool does not touch.

Both figures are now stale in different ways, and neither should be quoted. The 2.2 s came from a
production run that predates both the streaming fix and ADR-0002's flags. The 0.9 s was measured
through `--input-format stream-json`, which is not the invocation a request makes.
`scripts/latency-breakdown.js` answers the question from the request log instead, on real traffic
and without spending quota.

## Decision

**One CLI process per request, spawned and discarded. No pool, no reuse, no warm process.**

Decision 4 of `docs/IDENTITY.md` is rewritten to say so, and the isolation clause it carried is
promoted from a condition on the pool to the reason there is none.

Latency work continues where it does not touch process lifetime: the streaming fix (taken,
2026-09-19), the CLI flag set (ADR-0002), and whatever the request-log decomposition turns up.

## Consequences

- Every request pays a cold start. On the 2026-09-21 server measurement that is about 0.9 s of a
  short call — real, and the price of the isolation guarantee rather than an oversight.
- `SHELLM_POOL_CLAUDE`, the knob the revamp log planned, is not built. Nothing to configure.
- A caller that wants a conversation sends the history, as both wire formats already require.
- **What would reopen this:** SheLLM growing a real conversation identity — a sessions endpoint,
  or a resume cursor tied to a caller — at which point a process bound to one conversation becomes
  possible and t3code's shape applies. A CLI reset flag alone is not enough, and that is the whole
  point of the structural argument above.

## What did not change

The binary is still the official one, unmodified, driven by its documented flags. This ADR removes
a planned change; it takes nothing away from what ships today.
