# Benchmarks — production, 2026-09-19

The first latency measurement of SheLLM on the real server. Until now the only numbers were from
a laptop (3–4 s spawned per request, ~1 s with a warm process), which is what
[`IDENTITY.md`](../IDENTITY.md) decision 4 rests on. These replace them with something measured
where the service actually runs.

## What was measured, and how

| | |
|---|---|
| Server | the production VPS, systemd, one CLI process spawned per request and discarded |
| Reached through | Cloudflare Tunnel over HTTPS (edge LAX at the time of the run) |
| Client | a dev container on a different network — every number includes internet and tunnel round trip |
| CLI | `claude` 2.1.273, pinned ([`VERSIONS.md`](../../VERSIONS.md)) |
| Samples | 3 per row. The median is reported, the min–max range beside it |
| Cost | about 50 real requests against the subscription |
| Tool | [`scripts/bench.js`](../../scripts/bench.js), no dependencies |

**Three samples is not a distribution.** Read these as orders of magnitude, not as an SLA. Where
the range is wide, the range is the finding.

## Overhead floor — no CLI, no quota

| Request | Median | Range |
|---|---|---|
| `GET /health` | 0.26 s | 0.26–0.28 s |
| `GET /v1/models` | 0.26 s | 0.25–0.27 s |

Roughly a quarter of a second is network and tunnel. Every number below carries it.

## Model — tiny prompt, one-word answer

| Model | Median | Range |
|---|---|---|
| `claude` (CLI default) | 2.68 s | 2.56–3.66 s |
| `claude-haiku` | 2.93 s | 2.57–3.93 s |
| `claude-sonnet` | 3.23 s | 2.98–3.42 s |
| `claude-opus` | 2.98 s | 2.66–3.10 s |

The models are indistinguishable here, haiku included. For a short answer you are paying for
process startup, not for inference — **picking a cheaper model to go faster does not work**.

## Prompt length — `claude-sonnet`, one-word answer

| Prompt | Median | Range |
|---|---|---|
| tiny (~8 tok in) | 2.52 s | 2.45–3.40 s |
| medium (~509 tok in) | 4.06 s | 3.55–4.99 s |
| large (~4009 tok in) | 3.73 s | 2.90–3.83 s |

A 4 000-token prompt costs about a second more than a ten-token one, and no more than a
500-token one. Context is close to free; do not compress a prompt to save latency.

## Output length — `claude-sonnet`, tiny prompt

| Answer asked for | Median | Range |
|---|---|---|
| word (~4 chars out) | 3.25 s | 3.17–3.67 s |
| paragraph (~626 chars out) | 6.45 s | 5.76–6.69 s |
| page (~3470 chars out) | 16.21 s | 16.16–19.02 s |

This is the dimension that costs. Generation runs at roughly 250 characters per second once the
process is up. A request that asks for a page of text needs a client timeout well above the
default of most HTTP libraries.

## Streaming — 100-word answer on `/v1/chat/completions`

| Model | Total (median) | Range | First chunk |
|---|---|---|---|
| `claude-haiku (stream)` | 17.60 s | 12.43–19.92 s | 17.11 s |
| `claude-sonnet (stream)` | 6.00 s | 5.70–7.17 s | 5.44 s |

This run is what uncovered the bug fixed in the section below: the first chunk arrived at 5.44 s
of a 6.00 s request, because the CLI finished and the whole answer was then flushed at once.

**A correction worth stating plainly.** The first reading of this run was that `/v1/messages`
streamed properly, because its first *event* arrived at 0.76 s. It did not. That event is
`message_start`, which SheLLM sends before calling the CLI at all. Measuring time-to-first-*text*
instead — `scripts/bench.js` now records both — shows the Anthropic endpoint was flushing at the
end too. A metric that moves when nothing real moved is worse than no metric.

## Streaming, before and after the fix

Same machine, same `claude` 2.1.273, a local SheLLM on each side, so these compare to each other
and not to the production table above. "First text" is the first character of the answer reaching
the client; the gap between it and the total is the part a person watches scroll by.

| Endpoint and model | Total (median) | First text |
|---|---|---|
| `claude-sonnet (stream)` on `/v1/chat/completions`, before the fix (n=3) | 5.67 s | 5.17 s |
| `claude-sonnet (stream, /v1/messages)` before the fix (n=3) | 12.36 s | 11.80 s |
| `claude-haiku (stream)` before the fix (n=3) | 11.93 s | 11.40 s |
| `claude-sonnet (stream)` on `/v1/chat/completions`, after the fix (n=5) | 5.78 s | 1.71 s |
| `claude-sonnet (stream, /v1/messages)` after the fix (n=5) | 5.48 s | 1.76 s |
| `claude-haiku (stream)` after the fix (n=5) | 13.20 s | 12.07 s |

Before, the answer always landed in one piece at the end: first text was 91–95 % of the request on
both endpoints. After, `claude-sonnet` starts writing at 1.7 s of a 5.5 s request, in 68 chunks.

The cause was one flag. `claude --print` buffers and prints once; only
`--output-format stream-json --verbose --include-partial-messages` emits token events, and the
provider was not asking for it — a comment in `claude.js` asserted the opposite.

**`claude-haiku` remains an open question.** Its first text is still 91 % of the request after the
fix, and a 100-word answer takes about twice what `claude-sonnet` takes. The delay is not SheLLM's:
the server logs its first token from the provider at the same moment the client receives it
(`ttft_ms=9534` in one traced haiku request, against `ttft_ms=1823` for sonnet). Yet the same CLI
called directly produced haiku's first text in 1.6 s. Unexplained, reproducible, and reason enough
not to pick haiku for latency.

## Endpoint parity — `claude-sonnet`, tiny prompt

| Endpoint | Median | Range |
|---|---|---|
| `POST /v1/chat/completions` | 2.78 s | 2.70–3.73 s |
| `POST /v1/messages` | 4.07 s | 2.78–4.25 s |

The ranges overlap; with three samples this is not evidence that one format is faster.

## Concurrency — 6 at once, `claude-haiku`

| Measure | Value |
|---|---|
| `6 parallel (claude-haiku)` — per-request median | 3.09 s (range 2.88–5.10 s) |
| Wall clock for all six | 5.10 s |
| Statuses | `200 200 200 200 200 200` |

Six simultaneous requests all succeeded, none was rate limited, and the slowest paid about two
extra seconds queueing. The queue does what it says; there is no need to serialize calls in a
client, as long as you stay at this scale.

## What this says about the warm pool

Decision 4 in [`IDENTITY.md`](../IDENTITY.md) says latency gets fixed by keeping processes warm.
The server numbers do not contradict it, and now it has a baseline to beat:

- The floor for **any** answer is about 2.5 s, of which 0.26 s is network. So roughly **2.2 s per
  request is process startup** — the part a warm pool would remove.
- On the laptop the same gap was 3–4 s spawned versus ~1 s warm. The server is faster than the
  laptop was, so the prize is smaller than the original measurement suggested: expect to save
  around 2 s, not 3.
- Generation itself (250 chars/s) is untouched by any of this. For the long answers that cost 16 s,
  a warm pool changes about 13 % of the wall clock.

The honest reading: a warm pool is worth it for short, interactive calls and nearly irrelevant for
long ones. **The streaming fix was the cheaper win, and it is already taken** — for
`claude-sonnet` it moved perceived latency from 5.17 s to 1.71 s by changing two CLI flags,
without touching process lifetime or the ban-risk boundary.

## Reproduce it

```bash
export SHELLM_BASE=https://shellm.example.com
export SHELLM_KEY=shellm-...

node scripts/bench.js --suite latency --iterations 3 --concurrency 6 --model claude-sonnet
node scripts/bench.js --suite capabilities --model claude-sonnet
node scripts/bench.js --suite latency --only streaming --iterations 5   # re-measure one thing
```

`--out run.json` records the raw result. Every request is real, so a full run spends about 50
requests of subscription quota — and a benchmark outruns the default 30 req/min global limit on a
fast instance, so raise `SHELLM_GLOBAL_RPM` or use `--only`. The run reports how many requests came
back 429 rather than quietly averaging them away.

**The production table above predates the streaming fix.** Re-run the latency suite against the
server after the next deploy and replace it.

## What this does not measure

Token throughput as the provider counts it, a cold VPS, sustained load over hours, the behaviour
at a usage limit, any provider other than Claude, and anything at all about answer quality.
