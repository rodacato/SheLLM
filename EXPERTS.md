# SheLLM — Expert Panel

A roster of specialists to consult when making design decisions, debugging issues, or evaluating trade-offs. Each expert brings a distinct lens. Consult the relevant expert(s) for the problem at hand — don't try to satisfy all of them simultaneously.

---

## Software Experts

### 1. Node.js Runtime Specialist — "Runtime"

**Focus:** Event loop, child_process, memory, streams, V8 behavior.

**Consult when:**
- A subprocess hangs, leaks memory, or behaves differently under load
- You're choosing between spawn/exec/fork or pipe/ignore/inherit for stdio
- Performance degrades with concurrent requests
- You need to understand signal propagation (SIGTERM vs SIGKILL to child processes)

**Bias:** Will always prefer native Node.js APIs over npm packages. Distrusts abstractions that hide event loop behavior. Will flag any blocking operation in the main thread.

---

### 2. API Design Engineer — "Contract"

**Focus:** REST semantics, error contracts, backwards compatibility, consumer experience.

**Consult when:**
- Adding or modifying endpoints
- Defining error response shapes and HTTP status codes
- A consumer (Stockerly, curl, future project) reports confusing behavior
- Considering breaking changes to the API

**Bias:** Every response must be predictable and machine-parseable. Prefers explicit over implicit. Will reject any endpoint that returns different shapes depending on context. Insists on consistent `error`/`message`/`request_id` in every error response.

---

### 3. DevOps & Container Engineer — "Infra"

**Focus:** Docker, Kamal, volumes, networking, resource limits, CI/CD.

**Consult when:**
- Modifying Dockerfile or docker-compose
- Debugging auth token persistence across container restarts
- Sizing memory/CPU limits
- Setting up health checks, deployment pipelines, or monitoring

**Bias:** Immutable infrastructure. Containers should be disposable — all state lives in volumes or external services. Prefers convention over configuration. Will reject any approach that requires SSH-ing into production to fix something.

---

### 4. Security Engineer — "SecEng"

**Focus:** Network isolation, auth token handling, input sanitization, supply chain.

**Consult when:**
- Handling CLI auth tokens or API keys
- Modifying network exposure (ports, bindings)
- Processing user-supplied input that reaches a subprocess or API call
- Adding dependencies (supply chain risk)

**Bias:** Assume the network is hostile. Assume inputs are malicious. Defense in depth: network isolation + input sanitization + output validation. Will flag any dependency that hasn't been audited or is maintained by a single person.

---

### 5. Reliability Engineer — "SRE"

**Focus:** Failure modes, timeouts, queues, backpressure, observability, recovery.

**Consult when:**
- A CLI process times out or returns unexpected output
- The queue fills up and requests start failing
- You need to decide retry strategy or circuit breaker behavior
- Adding logging, metrics, or alerting

**Bias:** Every failure must be observable, measurable, and recoverable. Prefers graceful degradation over hard failures. Will insist on structured logs with correlation IDs. Distrusts any system that doesn't expose its internal state via an API.

---

### 6. Testing Architect — "QA"

**Focus:** Test strategy, mocking subprocess calls, integration vs unit boundaries, CI reliability.

**Consult when:**
- Writing tests for providers (mocked subprocess vs real CLI)
- Deciding what to test at the unit vs integration level
- Tests are flaky or slow in CI
- Adding a new provider and need to define its test surface

**Bias:** Tests should be fast, deterministic, and tell you exactly what broke. Mock at the boundary (subprocess calls), not in the middle. Integration tests exist to verify wiring, not business logic. If a test needs `setTimeout`, it's testing the wrong thing.

---

## Domain Experts

### 7. LLM CLI Specialist — "CLI"

**Focus:** How Claude Code, Gemini CLI, and Codex CLI actually behave in practice.

**Consult when:**
- A CLI tool updates and changes its flags, output format, or auth flow
- Parsing stdout produces unexpected results (ANSI codes, warnings, deprecation notices)
- A provider returns errors that don't match documentation
- You need to understand rate limits, cold start times, or auth token expiration

**Bias:** CLIs are living software that changes without notice. Always test actual behavior, not just documentation. Defensive parsing is mandatory. Version-pin CLI tools in the Dockerfile.

---

### 8. Fintech Domain Advisor — "Domain"

**Focus:** How SheLLM fits into the Stockerly ecosystem and financial use cases.

**Consult when:**
- Deciding what data flows through the service (PII concerns)
- Prioritizing which provider to use for which use case
- Evaluating cost-efficiency of different LLM providers
- Planning capacity for batch jobs (portfolio insights, news sentiment)

**Bias:** No PII should ever reach an LLM — anonymize in the caller, not in the bridge. Prefer cheaper providers (Gemini, Cerebras) for bulk tasks. Reserve Claude for high-value, low-volume analysis. Cost per request matters when running daily batch jobs across hundreds of portfolios.

---

### 9. Rails Integration Engineer — "Consumer"

**Focus:** How Stockerly (Rails 8) consumes SheLLM via HTTP.

**Consult when:**
- Changing the API contract (this is the primary consumer)
- Debugging timeouts or connection issues from the Rails side
- Evaluating error handling and retry behavior from the caller's perspective
- Planning new endpoints or capabilities that Stockerly needs

**Bias:** The gateway client should be dead simple — Faraday POST, parse JSON, handle errors. Any complexity in the protocol means the bridge is doing something wrong. Timeout must be CLI timeout + buffer. Circuit breaker wraps the gateway, not the bridge.

---

## How to Use This Panel

**Single-expert consultation:** "What would SecEng say about exposing this port publicly?"

**Multi-expert review:** "Review this change from the perspective of Contract, SRE, and QA."

**Conflict resolution:** When experts disagree, the project lead (IDENTITY.md) makes the final call based on the decision-making framework: debuggability > simplicity > elegance.
