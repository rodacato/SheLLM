# ADR-0002 — One-shot requests run with the CLI's internal tools off

- **Status:** accepted
- **Date:** 2026-09-19
- **Amends:** ADR-0001's provider behaviour; reverses "CLI internal tools stay ON" from the
  2026-09-17 revamp decision log, which never became an ADR of its own

## Context

SheLLM starts `claude` once per request, in an empty temporary directory, to turn one prompt into
one answer. Until now it left the CLI's internal tools enabled — file reads, shell, web — on the
argument that an app backend might want the model to do work rather than only write text.

Three things moved since that call was made:

- **It is measurable, and it is not free.** On 2026-09-19, ten samples a side on one host: the
  flag set without `--tools ""` measured 2.51 s median, with it 2.28 s — about 250 ms, or 10 %,
  spent on tool definitions the model never used. `docs/guides/benchmarks.md` has the run.
- **There is nothing to use them on.** The working directory is a fresh temp dir with no files,
  created and destroyed per request. A tool call can only read what SheLLM did not put there.
- **Consistency with the upstream this project borrows from.** `pingdotgg/t3code` drives the same
  binaries in one-shot mode with this flag set, and is more active at finding CLI workarounds.
  Matching it makes their fixes readable as hints for ours instead of a diff to reinterpret.

## Decision

Every request adds `--tools ""` and `--permission-mode dontAsk` to the flags already passed:

```
--print --tools "" --disable-slash-commands --strict-mcp-config
--settings '{"disableAllHooks":true}' --permission-mode dontAsk --dangerously-skip-permissions
```

`--permission-mode dontAsk` is redundant with `--dangerously-skip-permissions` today. It is
carried anyway, as part of a set kept identical to the upstream one, so that a future change in
either flag's meaning shows up as a behaviour difference rather than as a silent divergence.

## Consequences

- The model answers from the prompt alone. It cannot read a file, run a command or fetch a URL,
  which is what an empty temp directory already implied.
- Emulated function calling for a caller's `tools` field is unaffected: that is phase 3, it runs
  in the prompt, and it never depended on the CLI's own tools.
- A feature that genuinely needs the CLI to act — an agentic endpoint, a project with a working
  directory — supersedes this ADR rather than flipping the flag in a PR.
- The saving is real but small next to CLI startup: about 250 ms of a 2.3 s floor. It does not
  change the case for the warm pool.

## What did not change

The binary is still the official one, unmodified, driven by its documented flags. Nothing here
touches credentials, the wire formats, or the one-process-per-request rule.
