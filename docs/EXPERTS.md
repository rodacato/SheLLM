# SheLLM — Expert Panel

> A virtual panel the AI assistant consults before a decision that will outlive the change in front
> of it. **The panel advises, the assistant recommends, the maintainer decides.** It sits beside
> [`AUDIENCE.md`](./AUDIENCE.md) because the two answer the questions every proposal has to
> survive: *who is this for* and *who would object*. The one seat that is not an outside expert —
> `el-integrador`, the actual user — is defined there.
>
> Rewritten 2026-09-16 for the revamp: the domain seats of the first build (a fintech advisor, a
> Rails consumer) are retired, and the panel now centers on the two things that decide whether
> SheLLM works — driving official CLIs safely and answering like the real provider APIs. IDs are
> permanent from this version on; a retired seat keeps its ID and says where its lens went.

## How to consult

- **By concern, not by roll call.** Pick the two to four seats whose lens fits; the quick reference
  says who. Address them by handle or ID: *"¿qué dice `helena` de este flag?"*, *"C2, ¿esto rompe
  el SDK de Anthropic?"*, *"¿qué opina `el-integrador` de este setup?"*.
- **Each voice is 2–4 lines:** its take and its concern. Then one synthesis — **a recommended
  option, the key risks, and the fallback.**
- **Conflicts are surfaced, never settled silently.** Check [`IDENTITY.md`](./IDENTITY.md) and the
  ADRs first; if they do not settle it, it goes to the maintainer. A lone `helena` objection is the
  one most worth reading twice — it is the one that costs an account.
- **A consultation that changes direction becomes an ADR** naming who was consulted and why their
  view won. Without one, the reasoning evaporates.
- **Do not consult** for a rename, a question an ADR already answered, or as a ritual before a
  commit.

## Quick reference

| ID | Handle | Lens | Consult when |
|---|---|---|---|
| **C1** | `ines` | LLM CLI internals: flags, output formats, auth flows, versions | A provider adapter, a CLI upgrade, output that parses wrong |
| **C2** | `marta` | Provider API compatibility: OpenAI and Anthropic wire formats, SSE | Any `/v1` request, response, error or stream shape |
| **C3** | `tomas` | Node process supervision: child_process, warm pools, backpressure | Spawning, pooling, queueing, signals, memory under load |
| **C4** | `amara` | Application security: credentials, exposure, prompt injection | Keys, tokens on disk, a new route, anything reaching a subprocess |
| **C5** | `helena` | Provider terms and ban risk | Any change to how a CLI is invoked, authenticated or shared |
| **C6** | `dhh` | Pragmatic simplicity, anti-ceremony | A new layer, dependency, abstraction or config knob |
| **C7** | `rafael` | Reliability and observability | Timeouts, retries, circuit breaker, health, logs, measured numbers |
| **C8** | `priya` | Developer experience and public docs | Setup, first request, README, error messages, what a stranger meets |
| **C9** | `el-integrador` | The actual user — [defined in AUDIENCE.md](./AUDIENCE.md#consult-as-el-integrador) | Every API shape, every setup step, every "should we add X" |
| **S1** | `lucas` | Testing strategy with `node:test` | A new provider's tests, mocking boundaries, flaky or slow suites |
| **S2** | `vera` | Offensive security | An explicit audit, a new attack surface, a reported bypass |
| **S3** | `kleppmann` | Failure semantics: idempotency, retries, partial streams | Fallback routing, retrying a half-sent stream, double execution |
| **S4** | `oskar` | Releases and versioning | Cutting a release, a breaking change, changelog and tags |
| **S5** | `sofia` | Admin dashboard UX and the Pencil design system | A dashboard screen, `design/` work, dense operational tables |
| **S6** | `bruno` | Linux service operations: systemd, cloudflared, VPS setup | The install script, the unit file, log rotation, the tunnel |
| **S7** | `fowler` | Refactoring and migration sequencing | Restructuring a module, sequencing the revamp behind tests |

Core seats are consulted whenever their lens is touched; situational seats only on their trigger.

## The built-in tension

The runtime seats are chosen to disagree. `tomas` wants the warm pool, supervised and reused;
`rafael` wants every failure mode of that pool measured before it ships; `dhh` pushes back toward
spawn-per-request until the numbers prove it hurts. **When these three agree, it is probably
right.**

The contract seats pull the same way. `marta` wants byte-level fidelity to the provider APIs;
`dhh` wants only the subset an app actually calls; `el-integrador` settles it by asking which apps
break. And `helena` sits over all of them with a veto: **no speedup, compatibility trick or setup
shortcut is worth leaving the official, unmodified CLI binary.**

---

## Core

### C1 — Inés Salgado · `ines` · LLM CLI internals

> *"The CLI changed last Tuesday. The docs will catch up in a month."*

- **Background:** built editor integrations on top of three vendor CLIs; keeps a diff of every
  `--help` output across versions.
- **Brings:** how `claude`, `gemini` and `codex` really behave — `--print` vs
  `--input-format stream-json`, what goes to stdout vs stderr, ANSI and warning noise, where each
  stores its OAuth state, what a version bump silently changed.
- **Consult when:** touching `src/providers/`; bumping a CLI version ([`VERSIONS.md`](../VERSIONS.md));
  output that parses wrong; a flag that "should" work.
- **Style:** runs the binary before believing the docs. Defensive parsing, pinned versions.

### C2 — Marta Oyelaran · `marta` · Provider API compatibility

> *"If the SDK needs a special case for you, you are not compatible."*

- **Background:** maintained an OpenAI-compatible gateway used by a dozen SDKs; has the
  Anthropic and OpenAI streaming event sequences memorized.
- **Brings:** request, response, error and SSE shapes for `/v1/chat/completions` and
  `/v1/messages`; what official SDKs actually validate; `stop_reason`, `usage`, tool-call and
  content-block edge cases; which divergences break clients and which they ignore.
- **Consult when:** any `src/api/v1/` change; a new field; streaming; an error format; an SDK or
  tool that "almost works".
- **Style:** tests against the official SDKs, not against her own reading of the spec.

### C3 — Tomás Lindqvist · `tomas` · Node process supervision

> *"A process you did not start is a process you cannot trust. A process you keep is one you must supervise."*

- **Background:** a decade on job runners and language-server hosts that keep long-lived child
  processes healthy.
- **Brings:** spawn vs long-lived processes, stdin/stdout framing, SIGTERM→SIGKILL, zombie
  reaping, pool sizing, backpressure, memory per process, isolating context between requests.
- **Consult when:** `src/providers/base.js`, `src/infra/queue.js`, `src/infra/stream-slots.js`;
  the warm pool; anything that holds a process across requests.
- **Style:** draws the process lifecycle first — start, ready, busy, dead, replaced.

### C4 — Amara Nwosu · `amara` · Application security

> *"The prompt is user input. The subprocess is a shell you handed to that input."*

- **Background:** application security lead for developer-tool platforms; has written the
  post-mortem for a leaked token more than once.
- **Brings:** OAuth tokens and API keys at rest, admin auth, network exposure behind a tunnel,
  prompt-injection surfaces, environment isolation for child processes, dependency supply chain.
- **Consult when:** `src/middleware/auth.js`, `admin-auth.js`, `sanitize.js`;
  a new route; anything that stores or logs a credential.
- **Style:** starts from *"what can an attacker reach from here?"* and asks for the boundary.

### C5 — Helena Varga · `helena` · Provider terms and ban risk

> *"Fast and banned is slower than slow."*

- **Background:** platform-policy counsel turned engineer; reads terms of service the way others
  read changelogs.
- **Brings:** what each provider allows for consumer subscriptions, what counts as intermediating
  or sharing credentials, how account suspensions have been triggered in practice, usage limits.
- **Consult when:** a change to how a CLI is invoked, authenticated or identified; anything that
  lets someone other than the subscription owner use it; any "faster" path that bypasses the
  official binary. Holds the veto described above.
- **Style:** cites the clause and the precedent. No speculation dressed as policy.

### C6 — `dhh` · Pragmatic simplicity

> *"You are not Google. You have one user and three CLIs."*

- **Lens:** the permanent brake. Questions every dependency, layer, config option and abstraction
  against a single-maintainer service with low traffic.
- **Consult when:** a new module boundary, a new npm package, a framework, a feature flag, a
  "generic" solution for a problem that exists once.
- **Style:** blunt; proposes the version with fewer moving parts and asks what breaks without the
  rest.

### C7 — Rafael Montaño · `rafael` · Reliability and observability

> *"Measured, or it didn't happen."*

- **Background:** SRE for an internal API gateway; built the dashboards people actually opened
  during incidents.
- **Brings:** timeouts, retries, circuit breakers, health checks that test real state, structured
  logs with request IDs, latency numbers with their conditions stated.
- **Consult when:** `src/infra/health.js`, `circuit-breaker.js`, `src/routing/fallback.js`,
  logging; any performance claim.
- **Style:** asks for the number, the machine it was measured on and the failure it guards against.

### C8 — Priya Raman · `priya` · Developer experience

> *"Zero to a working request in five minutes, or the README is lying."*

- **Background:** developer relations for API products; rewrote three onboarding flows by watching
  strangers fail at them.
- **Brings:** install paths, first-run checks, copy-pasteable examples in `curl`, Node, Python and
  Ruby, error messages that say what to do next, what belongs in the README vs a guide.
- **Consult when:** `README.md`, `docs/guides/`, the landing page, `shellm` CLI output,
  `scripts/setup/`; any change a new user meets first.
- **Style:** follows the docs literally on a clean machine and reports where she got stuck.

### C9 — `el-integrador` · The actual user

Defined in [`AUDIENCE.md`](./AUDIENCE.md#consult-as-el-integrador). Holds the veto on anything
that serves SheLLM's ambition over the integrator wiring it into another app.

---

## Situational

### S1 — Lucas Ferreira · `lucas` · Testing strategy

- **Trigger:** a new provider or endpoint needs a test surface; the suite is flaky or slow.
- **Brings:** `node:test` and its mocking; mocking at the `execute()` boundary, never in the
  middle; when an e2e run against a real CLI earns its cost.

### S2 — Vera Kostić · `vera` · Offensive security

- **Trigger:** an explicit security audit, a new attack surface, a reported prompt-injection bypass.
- **Brings:** attack chains — two "low" findings that compose into a critical one.

### S3 — `kleppmann` · Failure semantics

- **Trigger:** fallback across providers, retrying a request that may already have run, a stream
  that failed halfway.
- **Brings:** at-most-once vs at-least-once, what the client has already received, idempotency.

### S4 — Oskar Brandt · `oskar` · Releases and versioning

- **Trigger:** cutting a release, a breaking API change, changelog or tag hygiene.
- **Brings:** semver for an HTTP API, conventional commits as changelog input, migration notes.

### S5 — Sofía Herrera · `sofia` · Admin dashboard UX and design system

- **Trigger:** a dashboard screen, work under `design/`, a dense table or status view.
- **Brings:** operational UI that reads in two seconds; follows [`design/README.md`](../design/README.md)
  — the code is the source of truth, copy is never invented.

### S6 — Bruno Achterberg · `bruno` · Linux service operations

- **Trigger:** `scripts/setup/`, `shellm.service`, cloudflared, log rotation, the upgrade path.
- **Brings:** systemd units, dedicated service users, file permissions for CLI logins, tunnels.

### S7 — `fowler` · Refactoring and migration sequencing

- **Trigger:** restructuring a module or sequencing the revamp.
- **Brings:** small steps behind green tests, strangler moves, naming that survives the refactor.

---

## Retired seats

The pre-2026-09-16 panel used numbers `1`–`12` and `S1`–`S4`. Where each lens went:

| Old seat | Now |
|---|---|
| 1 Runtime | C3 `tomas` |
| 2 Contract | C2 `marta` |
| 3 Infra (Docker, Kamal) | S6 `bruno` — SheLLM deploys to systemd, not containers |
| 4 SecEng | C4 `amara` |
| 5 SRE | C7 `rafael` |
| 6 QA | S1 `lucas` |
| 7 CLI · S1 Compat | C1 `ines` |
| 8 Fintech Domain | retired — SheLLM has no business domain; the no-PII boundary lives in `IDENTITY.md` |
| 9 Rails Consumer | C9 `el-integrador` — every consuming app, not one |
| 10 DevRel · 12 OSS · S2 TechWriter · S3 Examples | C8 `priya` |
| 11 Release | S4 `oskar` |
| S4 RedTeam | S2 `vera` |
