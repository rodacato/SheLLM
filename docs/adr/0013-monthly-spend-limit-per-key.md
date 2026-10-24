# ADR-0013 — A key can carry a monthly spend limit, approximate by design

- **Status:** accepted
- **Date:** 2026-10-24
- **Builds on:** ADR-0012. Its estimate stops being display-only: it now decides whether a request runs.

## Context

The owner wants to hand an app a key with a fair-use allowance — "about $100 a month" — so one app
cannot eat the subscription for the rest. Nothing is billed per request, so the dollars are the
API-equivalent figures SheLLM already logs: `cost_usd` from claude, `cost_estimate_usd` for codex.
A request's cost is known only after it finishes.

## Decision

**A key has an optional `spend_limit_usd`; the period is the calendar month in UTC.** Auth sums
`COALESCE(cost_usd, cost_estimate_usd)` over the key's `request_logs` rows since the first of the
month, and refuses with `429 spend_limit_exceeded` once the sum reaches the limit. `Retry-After`
points at the next month and `x-should-retry: false` stops both SDKs from retrying a refusal that
seconds cannot fix. A key without a limit is never checked.

**The limit is checked before a request and charged after it, so it is soft.** The request that
crosses the limit finishes, and so does anything already in flight. Overshoot is bounded by the
cost of those requests, which at the queue's concurrency is cents to a few dollars.

**Spend is read from the request log, not kept in a counter.** Retention goes from 30 to 31 days
so the first day of a long month is still there on its last day.

## Alternatives

- **Reserve an estimated cost before running.** An exact cap, but it needs a token estimate of the
  answer before it exists, and a release path for every failure. Ceremony for a fair-use cap. Rejected.
- **A running counter on the key.** Faster, but a second copy of what the log already holds, which
  drifts on every failed write and on log edits. The per-request query is indexed by `client_id`.
  Rejected while the query stays cheap.
- **A configurable period (day/week/month).** No caller needs anything but a month. Not built.

## Consequences

- A model missing from `config/model-prices.yaml` costs $0 against the limit. A stale manifest
  under-counts codex; a key meant to be capped should use priced models.
- Raising or removing the limit takes effect on the next request; nothing is reset.
- `/v1/models` is refused too once the limit is reached: the key is out of allowance, not one model.
