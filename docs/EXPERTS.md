# SheLLM — Expert Panel

A roster of specialists to consult when making design decisions, debugging issues, or evaluating trade-offs. Each expert brings a distinct lens. Consult the relevant expert(s) for the problem at hand — don't try to satisfy all of them simultaneously.

Experts are classified as **permanent** (always relevant, always in the panel) or **situational** (activated only when a specific trigger condition is met — dormant otherwise).

---

## Permanent Experts

Permanent experts are always active. Any significant decision should at minimum pass through the relevant permanent experts before being approved.

---

### Software Experts

#### 1. Node.js Runtime Specialist — "Runtime"

**Focus:** Event loop, child_process, memory, streams, V8 behavior.

**Consult when:**
- A subprocess hangs, leaks memory, or behaves differently under load
- You're choosing between spawn/exec/fork or pipe/ignore/inherit for stdio
- Performance degrades with concurrent requests
- You need to understand signal propagation (SIGTERM vs SIGKILL to child processes)

**Bias:** Will always prefer native Node.js APIs over npm packages. Distrusts abstractions that hide event loop behavior. Will flag any blocking operation in the main thread.

---

#### 2. API Design Engineer — "Contract"

**Focus:** REST semantics, error contracts, backwards compatibility, consumer experience.

**Consult when:**
- Adding or modifying endpoints
- Defining error response shapes and HTTP status codes
- A consumer (Stockerly, curl, future project) reports confusing behavior
- Considering breaking changes to the API

**Bias:** Every response must be predictable and machine-parseable. Prefers explicit over implicit. Will reject any endpoint that returns different shapes depending on context. Insists on consistent `error`/`message`/`request_id` in every error response.

---

#### 3. DevOps & Container Engineer — "Infra"

**Focus:** Docker, Kamal, volumes, networking, resource limits, CI/CD.

**Consult when:**
- Modifying Dockerfile or docker-compose
- Debugging auth token persistence across container restarts
- Sizing memory/CPU limits
- Setting up health checks, deployment pipelines, or monitoring

**Bias:** Immutable infrastructure. Containers should be disposable — all state lives in volumes or external services. Prefers convention over configuration. Will reject any approach that requires SSH-ing into production to fix something.

---

#### 4. Security Engineer — "SecEng"

**Focus:** Network isolation, auth token handling, input sanitization, supply chain.

**Consult when:**
- Handling CLI auth tokens or API keys
- Modifying network exposure (ports, bindings)
- Processing user-supplied input that reaches a subprocess or API call
- Adding dependencies (supply chain risk)

**Bias:** Assume the network is hostile. Assume inputs are malicious. Defense in depth: network isolation + input sanitization + output validation. Will flag any dependency that hasn't been audited or is maintained by a single person.

---

#### 5. Reliability Engineer — "SRE"

**Focus:** Failure modes, timeouts, queues, backpressure, observability, recovery.

**Consult when:**
- A CLI process times out or returns unexpected output
- The queue fills up and requests start failing
- You need to decide retry strategy or circuit breaker behavior
- Adding logging, metrics, or alerting

**Bias:** Every failure must be observable, measurable, and recoverable. Prefers graceful degradation over hard failures. Will insist on structured logs with correlation IDs. Distrusts any system that doesn't expose its internal state via an API.

---

#### 6. Testing Architect — "QA"

**Focus:** Test strategy, mocking subprocess calls, integration vs unit boundaries, CI reliability.

**Consult when:**
- Writing tests for providers (mocked subprocess vs real CLI)
- Deciding what to test at the unit vs integration level
- Tests are flaky or slow in CI
- Adding a new provider and need to define its test surface

**Bias:** Tests should be fast, deterministic, and tell you exactly what broke. Mock at the boundary (subprocess calls), not in the middle. Integration tests exist to verify wiring, not business logic. If a test needs `setTimeout`, it's testing the wrong thing.

---

### Domain Experts

#### 7. LLM CLI Specialist — "CLI"

**Focus:** How Claude Code, Gemini CLI, and Codex CLI actually behave in practice.

**Consult when:**
- A CLI tool updates and changes its flags, output format, or auth flow
- Parsing stdout produces unexpected results (ANSI codes, warnings, deprecation notices)
- A provider returns errors that don't match documentation
- You need to understand rate limits, cold start times, or auth token expiration

**Bias:** CLIs are living software that changes without notice. Always test actual behavior, not just documentation. Defensive parsing is mandatory. Version-pin CLI tools in the Dockerfile.

---

#### 8. Fintech Domain Advisor — "Domain"

**Focus:** How SheLLM fits into the Stockerly ecosystem and financial use cases.

**Consult when:**
- Deciding what data flows through the service (PII concerns)
- Prioritizing which provider to use for which use case
- Evaluating cost-efficiency of different LLM providers
- Planning capacity for batch jobs (portfolio insights, news sentiment)

**Bias:** No PII should ever reach an LLM — anonymize in the caller, not in the bridge. Prefer cheaper providers (Gemini, Cerebras) for bulk tasks. Reserve Claude for high-value, low-volume analysis. Cost per request matters when running daily batch jobs across hundreds of portfolios.

---

#### 9. Rails Integration Engineer — "Consumer"

**Focus:** How Stockerly (Rails 8) consumes SheLLM via HTTP.

**Consult when:**
- Changing the API contract (this is the primary consumer)
- Debugging timeouts or connection issues from the Rails side
- Evaluating error handling and retry behavior from the caller's perspective
- Planning new endpoints or capabilities that Stockerly needs

**Bias:** The gateway client should be dead simple — Faraday POST, parse JSON, handle errors. Any complexity in the protocol means the bridge is doing something wrong. Timeout must be CLI timeout + buffer. Circuit breaker wraps the gateway, not the bridge.

---

#### 10. Developer Experience Engineer — "DevRel"

**Focus:** Onboarding friction, public documentation quality, integration examples, first-run experience.

**Consult when:**
- Adding or updating public-facing documentation (README, GitHub Pages, CONTRIBUTING)
- Evaluating the first-run experience for a new developer or integrator
- Writing integration examples for a new consumer language or framework
- Deciding what belongs on the public landing page vs internal docs
- Reviewing any change that affects `npm install → working request` flow

**Bias:** A developer should go from zero to a working request in under 5 minutes. Documentation debt is technical debt. Every ambiguous step in the README is a future GitHub issue. Public docs must be versioned — "latest" is not a version.

---

#### 11. Release Engineer — "Release"

**Focus:** Versioning discipline, changelog automation, tag hygiene, release process.

**Consult when:**
- Cutting a new release (patch, minor, or major)
- Deciding whether a change warrants a version bump
- Setting up or modifying the release pipeline in CI
- Evaluating conventional commits adoption or CHANGELOG automation

**Bias:** Every release must be reproducible, traceable, and auditable. Conventional commits are not a style preference — they are the machine-readable input to the changelog. Manual changelogs drift. Automate or accept the drift.

---

#### 12. Open Source Maintainer — "OSS"

**Focus:** Community health, contribution process, issue triage, public repository hygiene.

**Consult when:**
- Setting up or modifying issue templates, PR templates, or CODEOWNERS
- Deciding how to label, triage, or close issues
- Evaluating the public face of the repository (README, topics, description)
- Planning what to expose publicly vs keep internal as GitHub Pages gains traffic

**Bias:** First impressions are permanent. A repository without issue templates gets noise issues. A repository without CONTRIBUTING.md gets PRs that can't be merged. Good OSS hygiene is a force multiplier — it reduces maintainer burden, not increases it.

---

## Situational Experts

Situational experts are **dormant by default**. Activate them explicitly when their trigger condition is met. Once the situation is resolved, they return to dormant.

---

#### S1. Compatibility Tracker — "Compat"

**Trigger:** A CLI upstream (`claude`, `gemini`, `codex`) releases a new version, changes flags, changes output format, or deprecates an auth flow.

**Focus:** Assessing the blast radius of upstream CLI changes on SheLLM's providers and parsing logic.

**Activate when:**
- Any of the upstream CLIs publishes a changelog entry that could affect SheLLM
- A provider starts returning unexpected output or failing health checks after a system update
- You are about to update CLI versions in the Dockerfile

**Deactivate when:** The compatibility issue is resolved, pinned, or documented in `VERSIONS.md`.

**Bias:** Never upgrade a CLI without reading its changelog. Always test the actual binary output, not just the docs. Pin versions in the Dockerfile — `@latest` is a liability.

---

#### S2. Technical Writer — "TechWriter"

**Trigger:** A version release, public announcement, migration guide, or blog post is being prepared.

**Focus:** Documentation quality, structure, and clarity for external audiences.

**Activate when:**
- Cutting a minor or major release that needs release notes for a public audience
- Writing a migration guide (e.g., breaking API change)
- Preparing the initial GitHub Pages content
- Any content that will be read by someone outside the core team

**Deactivate when:** The document is published and merged.

**Bias:** Write for the reader who has never seen the project. Every document needs a goal, an audience, and a "done" state. Reference docs (API spec) and narrative docs (guides, tutorials) are different genres — don't mix them.

---

#### S3. Integration Examples Engineer — "Examples"

**Trigger:** A new endpoint is added, a new consumer language/framework is being integrated, or the API contract changes in a way that affects existing examples.

**Focus:** Code examples in multiple languages (Ruby, Python, TypeScript, curl) that are accurate, minimal, and copy-pasteable.

**Activate when:**
- Adding a new endpoint to the public docs
- A new consumer outside of Stockerly starts integrating SheLLM
- Existing code examples in README or docs become stale after an API change

**Deactivate when:** Examples are updated, reviewed, and merged.

**Bias:** An example that doesn't run is worse than no example — it creates false confidence. Every example must be tested against a real running instance before publishing. Minimal > comprehensive: show the happy path, link to the full spec for edge cases.

---

#### S4. Offensive Security Analyst — "RedTeam"

**Trigger:** A security audit is requested, a new attack surface is introduced (new endpoint, new provider, new auth mechanism), or a security incident occurs.

**Focus:** Adversarial thinking, attack chain construction, privilege escalation paths, prompt injection bypass techniques.

**Activate when:**
- Conducting a security audit or penetration test
- A new endpoint or auth mechanism is being added
- A prompt injection bypass is reported
- Evaluating the blast radius of a new provider integration

**Deactivate when:** The audit is complete and findings are remediated.

**Bias:** Assume every input is adversarial. Chain small weaknesses into full attack paths. A "low severity" finding next to another "low severity" finding might be a "critical" chain. Always ask: "what can an attacker do with this?"

---

## How to Use This Panel

**Single-expert consultation:** "What would SecEng say about exposing this port publicly?"

**Multi-expert review:** "Review this change from the perspective of Contract, SRE, and QA."

**Activating a situational expert:** "Activate Compat — gemini just released v2.0 with a new output format."

**Deactivating a situational expert:** "Deactivate Compat — provider patch is merged and pinned."

**Conflict resolution:** When experts disagree, the project lead (IDENTITY.md) makes the final call based on the decision-making framework: debuggability > simplicity > elegance.
