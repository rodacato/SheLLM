# API conformance

`test/sdk/` proves the official SDKs accept what SheLLM sends, judged against fixtures we wrote.
This suite judges SheLLM against what the first-party APIs actually send: the same request goes
to Anthropic or OpenAI once, the response is recorded here, and from then on CI compares
SheLLM's response with that recording — offline, with the fake `claude` from `test/sdk/`, and no key.

It compares **shape, never text**: status, the headers that matter, every field's path and type,
the values that are part of the contract (`type`, `stop_reason`, `error.type`, `finish_reason`…),
and, for streams, the sequence of events.

## Recording

Keys go in `.env.conformance` at the repo root (gitignored). The prefix matters: a bare
`ANTHROPIC_API_KEY` in the shell makes the `claude` CLI bill the API instead of the subscription.

```sh
CONFORMANCE_ANTHROPIC_API_KEY=sk-ant-...
CONFORMANCE_OPENAI_API_KEY=sk-...
# optional: CONFORMANCE_ANTHROPIC_MODEL, CONFORMANCE_OPENAI_MODEL (defaults in targets.js)
# optional, for --target shellm: CONFORMANCE_SHELLM_URL, CONFORMANCE_SHELLM_API_KEY, CONFORMANCE_SHELLM_MODEL
```

```sh
npm run conformance:record -- --target anthropic,openai --dry-run   # what would be sent
npm run conformance:record -- --target anthropic,openai             # writes recorded/<target>/<case>.json
npm run conformance:record -- --target anthropic --only B03-prefill # one case again
```

Two more targets: `anthropic-openai` records the OpenAI-format cases against Anthropic's own
OpenAI-compatible endpoint (Claude behind the OpenAI format, like SheLLM), and `shellm` records a
live SheLLM, real CLIs included. A full run is one small request per case in `cases/`: cents, not dollars. Recordings
are redacted of the key and of org/project ids, but read the diff before committing them.

## Triage

```sh
npm run conformance:report                              # Markdown, every case
npm run conformance:report -- --live                    # judge recorded/shellm/ instead of the fake
npm run conformance:report -- --against anthropic-openai
```

Each ✗ is one of two things:

- **SheLLM is wrong** → fix it, or open a card on the board when it is more than a quick fix.
- **The difference is deliberate** → add `{ path, kind?, reason }` to the case's `accepted` (or to
  `ACCEPTED` when it holds for every case), and to "Known differences" in
  `docs/guides/api-compatibility.md` when a client could notice it.

`npm test` then holds the line: a case fails as soon as SheLLM drifts from its recording. Cases
not yet recorded are skipped. Re-record before a release or after an SDK bump, not on every PR.

Not recordable on purpose: 429, 529 and mid-stream failures, which the APIs do not produce on
demand. Those stay in `test/sdk/`.
