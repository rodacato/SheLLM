# ADR-0012 — A request the CLI does not price gets an estimate, kept apart from the reported cost

- **Status:** accepted
- **Date:** 2026-10-13
- **Builds on:** ADR-0009. Same kind of hand-kept manifest, for a different question.

## Context

Claude Code reports what each request would have cost on the API (`total_cost_usd`), and
SheLLM logs it as `cost_usd`. Codex reports token counts and no cost, so every codex request
read `not priced` and the API-equivalent figures covered claude alone. The owner wants codex
usage weighed the same way, clearly marked as an estimate.

Two facts shape the answer. The dashboard says the API equivalent "counts only requests with a
reported price", and an SDK reading `x_shellm.cost_usd` takes it as the CLI's figure. And the
price of a model changes (GPT-5.6 Sol is on promotional pricing until at least 2026-11-21),
while the tokens a request used do not.

## Decision

**An estimate is its own value: `cost_estimate_usd`, beside `cost_usd`, never inside it.** It is
written once, when the request is logged, as a new `request_logs` column (migration 018), and
returned as `x_shellm.cost_estimate_usd`. A request with a reported cost gets no estimate.
Aggregates report `estimated_requests` and `cost_estimate_usd` next to `priced_requests` and
`cost_usd`, and the dashboard shows the estimate as `~$… est.`, never summed into the reported
figure.

**Prices come from `config/model-prices.yaml`**, kept by hand: per upstream model, USD per
million tokens for input, cached input, cache writes and output, with the long-context rates
where the price table has them. Every entry carries its source URL and the date it was read. A
model the file does not name gets no estimate. Nothing is guessed from a similar model.

**The estimate is computed from token counts only:** fresh input, cache reads, cache writes and
output, at the rates for the model that ran. Reasoning tokens are already inside output and are not
added again. Above the long-context threshold the long-context rates apply. To know the model that
ran, codex now reports `upstream_model` (the model it passed with `-m`), as claude already does.

## Alternatives

- **Write the estimate into `cost_usd` with a flag.** Every existing sum would mix measured and
  estimated values unless each query split on the flag, and `x_shellm.cost_usd` would change
  meaning for SDK callers. Rejected.
- **Compute at read time from tokens and the manifest.** No migration, but history would be
  re-priced on every edit of the file, and older codex rows do not know which model ran. Rejected.

## Consequences

- The estimate is what the call would have cost on the API at the listed price that day. It is
  not what the subscription charged, and the dashboard says so.
- A price change applies from the next request onward. Past rows keep the price they were
  logged with.
- The manifest goes stale like ADR-0009's does, and is updated the same way: by hand, citing the
  page it came from.
- Codex rows now carry `upstream_model`, so by-model breakdowns file default-model calls under
  the model that ran instead of under `codex`.
