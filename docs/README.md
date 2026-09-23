# SheLLM documentation

## If you are using or running SheLLM

| | |
|---|---|
| [`guides/usage.md`](guides/usage.md) | Calling it: endpoints, models, parameters, errors, limits |
| [`guides/api-compatibility.md`](guides/api-compatibility.md) | Which OpenAI and Anthropic parameters are honored, ignored or rejected |
| [`guides/deployment.md`](guides/deployment.md) | The VPS runbook: install, systemd, the tunnel, backups, troubleshooting |
| [`guides/benchmarks.md`](guides/benchmarks.md) | Measured latency, with the machine and the conditions stated |
| [API reference](https://rodacato.github.io/SheLLM/api/) | The full contract, generated from [`api/openapi.yaml`](api/openapi.yaml) |

## If you are changing SheLLM

| | |
|---|---|
| [`guides/architecture.md`](guides/architecture.md) | Module layout, request flow, the provider and error contracts |
| [`guides/releasing.md`](guides/releasing.md) | How a release is cut |
| [`adr/`](adr/) | Decisions already taken. [ADR-0001](adr/0001-baseline.md) is the baseline; each later one says what it supersedes |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, conventions, tests, adding a provider |

## Not product documentation

`IDENTITY.md`, `AUDIENCE.md` and `EXPERTS.md` describe how the maintainer's **AI assistant** works
in this repository — the persona it adopts, who the project is built for, and a panel of invented
advisors it consults before a decision. They are checked in because the assistant reads them at the
start of every session, and because [`AGENTS.md`](../AGENTS.md) points at them.

They are not a description of the product, and nobody needs them to use or contribute to SheLLM.
`AUDIENCE.md` is the one worth reading anyway: it is the shortest honest statement of what this is
for and what it refuses to become.
