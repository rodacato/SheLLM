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

Two things here, and neither is good news:

1. **The OpenAI endpoint does not really stream.** The first chunk arrives at 5.44 s of a 6.00 s
   request — the CLI finishes, then the answer is flushed. The same probe against `/v1/messages`
   returned its first event at **0.76 s**. If a person is waiting on the output, use
   `/v1/messages`.
2. **`claude-haiku` streamed is consistently slow** — three runs between 12 and 20 seconds for an
   answer `claude-sonnet` streams in 6. This was not expected, it reproduced across all three
   samples, and it is unexplained. It deserves its own investigation before anyone picks haiku for
   latency.

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
long ones. **The streaming finding above is the cheaper win** — a native SSE path on
`/v1/chat/completions` takes perceived latency from 5.44 s to under a second, without touching
process lifetime or the ban-risk boundary.

## Reproduce it

```bash
export SHELLM_BASE=https://shellm.example.com
export SHELLM_KEY=shellm-...

node scripts/bench.js --suite latency --iterations 3 --concurrency 6 --model claude-sonnet
node scripts/bench.js --suite capabilities --model claude-sonnet
```

`--out run.json` records the raw result. Every request is real, so a full run spends about 50
requests of subscription quota.

## What this does not measure

Token throughput as the provider counts it, a cold VPS, sustained load over hours, the behaviour
at a usage limit, any provider other than Claude, and anything at all about answer quality.
