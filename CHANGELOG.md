# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.26.0] - 2026-10-28

### Breaking Changes

- **routing:** a request can opt out of fallback, never into it

### Added

- **update:** install the CLIs a release pins, and put them back on rollback

### Fixed

- **auth:** read the credential header in linear time
- **claude:** always pass a system prompt, empty when the caller sends none
- **site:** mark a refused inspector step with its own glyph
- **routing:** a request can opt out of fallback, never into it
- **config:** describe the health poller and the HTTP/2 note as they are
- **admin:** put SHELLM_REF after sudo in the rollback hint
- **codex:** pin memories off for every request
- **claude:** read limits from the CLI's own message and log a failure's API status
- **setup:** hold the CLI pins on the host and report drift in doctor

### Changed

- **circuit-breaker:** keep circuits in a prototype-less object

### Documentation

- **site:** recut the Overview and System captures from the current design
- **site:** show a recorded response in the quick start
- **site:** state the pitch's limits, and replay the pinned CLIs in the inspector
- **adr:** amend ADR-0007, the service worker does precache the CDN
- benchmarks open with where latency stands, persona files match the ADRs
- ops, release and security docs checked against the scripts
- architecture as a map, contributor rules in CONTRIBUTING
- one home per topic for callers, and the contract checked against the code

### Maintenance

- **gitleaks:** a CLI's API message id is not a key
- **catalog:** rebuild the model catalog against claude 2.1.312 and codex 0.165.0
- **prices:** price the four codex models 0.165.0 added
- **deps:** bump claude to 2.1.312 and codex to 0.165.0
- **deps:** bump zizmorcore/zizmor-action from 0.6.4 to 0.7.1

### Testing

- **e2e:** run the suite against the app as it is today

### CI

- **deps:** let Dependabot propose patch and minor CLI bumps


## [1.25.0] - 2026-10-24

### Added

- **logs:** keep stacks in the JSON line and stop logging probes
- **metrics:** expose Prometheus metrics on GET /metrics
- **server:** bind every address listed in HOST


## [1.24.0] - 2026-10-24

### Added

- **keys:** cap a key's monthly spend in API-equivalent dollars

### Maintenance

- **node:** require Node 24.22.1 and upgrade it on setup
- **deps:** bump express, dotenv and dev dependencies
- **deps:** bump dotenv from 18.0.6 to 18.0.7


## [1.23.0] - 2026-10-18

### Added

- **admin:** stack Logs and Keys rows into cards on a phone
- **keys:** copy a single value, or a snippet as .env or as an export
- **keys:** show the last characters of a key so it can be told apart

### Fixed

- **admin:** keep the Logs filter in the URL
- **admin:** keep a sideways table swipe from navigating back


## [1.22.0] - 2026-10-18

### Added

- **messages:** honor output_config.format and output_config.effort

### Fixed

- **messages:** send the fields and events the Anthropic API sends
- **messages:** refuse empty user content and a trailing assistant message

### Testing

- **conformance:** check meaning where shape cannot see it
- **conformance:** record the Anthropic API and accept what differs on purpose
- **conformance:** judge SheLLM against recorded first-party responses


## [1.21.0] - 2026-10-17

### Added

- **admin:** show why a provider failed, with Retry now, on System
- **circuit:** keep and log the cause of the last provider failure

### Fixed

- **claude:** stop served requests from updating the CLI
- **claude:** accept Zod 4 JSON schemas and refuse bad ones as 400
- **claude:** read the API failure from the CLI's result event

### Documentation

- **api:** note that claude drops a schema's $schema and refuses a bad one as 400
- **agents:** require English everywhere in the repo, designs included

### Maintenance

- **deps-dev:** bump supertest from 7.3.0 to 7.3.1
- **deps-dev:** bump @redocly/cli from 2.59.0 to 2.62.1
- **deps:** bump dotenv from 18.0.4 to 18.0.6
- **deps-dev:** bump @anthropic-ai/sdk from 0.131.0 to 0.132.1
- **deps-dev:** bump eslint from 10.11.0 to 10.12.0
- **deps:** bump ghcr.io/devcontainers/features/node
- **deps:** bump actions/setup-node from 7.0.0 to 7.1.0
- **brand:** move brand sources and guide into design/brand

### CI

- **quality:** lint and audit the workflows with actionlint and zizmor
- **workflows:** least privilege, timeouts and no persisted credentials
- **workflows:** name every workflow Category · Name


## [1.20.0] - 2026-10-13

### Breaking Changes

- **cli:** drop the daemon mode, systemd owns the process. `shellm start` runs in the foreground only, and `shellm stop`, `shellm restart` and `shellm logs` are gone: on a server use `systemctl` and `journalctl -u shellm`, elsewhere Ctrl+C and `shellm start` again. Updating from the dashboard is unaffected; it restarts the service through systemd.

### Added

- **admin:** show the period's errors like Latency, open and split
- **admin:** state the period's outcome once, and judge it
- **backup:** keep claude's state file in each snapshot
- **cli:** treat the env token as how claude authenticates
- **admin:** show cost estimates marked as such, beside reported cost
- **api:** estimate codex cost at API list price, apart from reported cost

### Fixed

- **admin:** finish the English-only pass on the Overview
- **admin:** name the dashboard by what SheLLM is
- **cli:** make shellm config read the config file it reports on
- **providers:** stop waiting for codex app-server once it has exited
- **site:** letter the social card in English
- **api:** keep a provider's usage limit on a streamed request
- **api:** answer errors passed to next() as JSON, never HTML
- **admin,site:** write product copy in English only

### Changed

- **infra:** share the hand-kept YAML manifest reader

### Documentation

- **design:** record D74, the cost estimate drawn in code before the boards
- **design:** record D32 and D34 as landed

### Maintenance

- **deps-dev:** bump @redocly/cli from 2.54.2 to 2.59.0
- **deps:** bump sonarsource/sonarqube-scan-action from 8.2.2 to 8.3.0
- **deps-dev:** bump openai from 7.23.0 to 7.28.0
- **deps-dev:** bump @anthropic-ai/sdk from 0.128.0 to 0.131.0


## [1.19.0] - 2026-10-13

### Added

- **admin:** clarify observed usage and unify product branding

### Fixed

- **api:** honor a body request_id on /v1/chat/completions
- **admin:** treat an undecodable session cookie as no session
- **admin:** compare log date filters as dates, not strings
- **auth:** spend the global rate limit only on admitted requests
- **queue:** let MAX_QUEUE_DEPTH=0 run requests that need no wait
- **api:** log a provider's failure against that provider
- **api:** report streamed outcomes to the circuit breaker consistently
- **providers:** stop the CLI when a stream's caller is gone
- **routing:** give back the circuit probe slot on every exit
- **admin:** only show USAGE LIMIT HIT for a provider 429 that has not cleared
- **devcontainer:** stop passing the host's gh token into the container
- **site:** give every lede-and-support section the same two columns
- **site:** stop What it is and Get started at the width of the page, not half of it

### Maintenance

- **deps:** bump dotenv from 18.0.1 to 18.0.4
- **deps:** bump ghcr.io/devcontainers/features/github-cli
- **deps-dev:** bump @redocly/cli from 2.53.3 to 2.54.2
- **deps-dev:** bump supertest from 7.2.2 to 7.3.0
- **devcontainer:** stop installing and persisting AI agent CLIs

### Testing

- **cli:** wait for restored server to exit before cleanup


## [1.18.0] - 2026-09-27

### Added

- **admin:** run every provider check on demand and show when each last passed

### Changed

- **api:** a request carrying `tools` or `functions`, or a `tool_choice` that forces a call, now gets a 400 `invalid_request_error` instead of a 200 prose answer that ignored them. Function calling was never supported; a caller that sent tools and read the prose will now see the error. `tools: []`, `"none"` and `"auto"` still pass

### Fixed

- **admin:** pin the CDN scripts to exact versions with subresource integrity
- **api:** send the fields and error types the official SDKs expect
- **messages:** always carry both cache counters in Anthropic usage
- **api:** refuse tools with a native 400 instead of answering in prose

### Documentation

- **adr:** record the security model as the floor that ships today
- **site:** an animated request path in the site's own style
- **site:** compare SheLLM with LiteLLM, CLIProxyAPI and new-api
- **site:** copy-paste streaming snippets for the official SDKs and curl
- **site:** lead with what SheLLM is — a personal project on your own subscriptions

### Maintenance

- **security:** record the Trivy and Gitleaks exceptions with their reasons
- **security:** suppress the reviewed Semgrep false positives inline

### Testing

- **sdk:** run the official openai and Anthropic SDKs against SheLLM
- **providers:** prove the isolation floor on what the CLI receives

### CI

- **quality:** make Semgrep, Trivy and Gitleaks findings fail the check
- **release:** pass the bump input through the environment, not into the script
- hold Dependabot version updates for a week after publication
- pin every GitHub Action to a full commit SHA


## [1.17.1] - 2026-09-27

### Fixed

- **update:** judge an update by what the service serves, and roll back every failure
- **logs:** record a zero queue wait and a zero cost as zeros, not as unmeasured
- **admin:** keep the dashboard signed in for seven days while it is used
- **admin:** fit the dashboard on a phone without restyling it

### Documentation

- **ci:** say what the release workflow does, and stop asking for hand-written changelog entries


## [1.17.0] - 2026-09-27

### Added

- **playground:** show the model that answered and copy the call as curl
- **claude:** run on the 1M-context variant by default where the account has one
- **models:** list the catalog on /v1/models with each model's limits, and take the context-1m beta

### Fixed

- **admin:** say 1 request and 1 recent failure
- **system:** drop the last good providers and settings when a re-read fails
- **logs:** keep the table still while it is being read, and name what the controls do
- **overview:** re-read providers with the stats, and stop showing unread or refused as ready
- **stats:** count priced requests on every cost figure
- **keys:** read expiry as an instant, in one zone, and report refused writes inline
- **system:** read what the page shows while it is on screen, and say when a read failed
- **admin:** stop the shell from reporting what it did not observe
- **site:** make the landing's copy-paste block work and bring both pages onto the admin kit
- **keys:** parse a stored expiry the same way whatever shape it was written in

### Changed

- **models:** keep the limits manifest as commented YAML under config/

### Documentation

- bring the guides, README and site up to date with the last releases


## [1.16.1] - 2026-09-25

### Fixed

- **claude:** stream a json_schema answer whole, from the validated output
- **providers:** decode CLI output as a UTF-8 stream
- **stream:** report a killed stream as an error instead of a finished answer


## [1.16.0] - 2026-09-25

### Added

- **providers:** send prompts on stdin and drop the 50,000-character cap
- **codex:** honour reasoning_effort, and run minimal as low on both
- **claude:** run at medium reasoning effort, and let a request set it

### Fixed

- **usage:** count cached input in prompt_tokens, and report reasoning apart
- **stream:** write an SSE keepalive while the model is silent

### Testing

- **queue:** pin the clock where a test asserts zero queued time


## [1.15.0] - 2026-09-25

### Added

- **admin:** show requests in flight, with whose they are, on Overview and Logs
- **config:** raise the default TIMEOUT_MS to 5 minutes and document proxy timeouts

### Fixed

- **cors:** answer a rejected /v1 body with CORS headers
- **admin:** edit a key in place, under its own row, and allow renaming it


## [1.14.0] - 2026-09-24

### Added

- **admin:** attach images in the Playground

### Fixed

- **admin:** send the sidebar's help link to the published docs

### Documentation

- **site:** recut the Playground crop to include its IMAGES block
- **site:** show what is built on SheLLM, and let the panels fade in
- say what health probes run, and show the photo-to-data shape


## [1.13.0] - 2026-09-24

### Added

- **api:** accept data: URL images on /v1/chat/completions
- **api:** accept response_format json_schema on /v1/chat/completions


## [1.12.0] - 2026-09-24

### Added

- **admin:** stack the Playground, and move the setting description to its own column
- **admin:** collapse the connection card on the Keys page
- **admin:** say what each setting does, and drop the reload column
- **admin:** collapse the settings unless there is something to act on

### Fixed

- **admin:** a long base URL no longer pushes the disclosure control out of its row, both
  collapsible sections announce whether they are open, and the Playground scrolls to the answer
  instead of leaving it below the fold

### Documentation

- recut the landing crops, and say what to do when it does not work


## [1.11.0] - 2026-09-23

### Added

- **admin:** say which command applies a settings change
- **admin:** group the settings by section and move them last
- **config:** declare every setting in one schema and generate .env.example

### Fixed

- **cli:** make init resolve values the way the server does
- **config:** stop a fresh install being warned about settings nobody added

### Documentation

- say how configuration works and how to change it

### Maintenance

- pin Node once, in .nvmrc, and have CI read it

### Testing

- stop the settings cases depending on what the release added


## [1.10.0] - 2026-09-23

### Added

- **admin:** say the origins field is a browser mechanism
- **server:** serve TLS when a certificate is configured
- **api:** report cost and timings a benchmark can read
- **queue:** tell the caller it is queued instead of leaving it silent
- **keys:** scope an API key to the origins allowed to use it
- **cors:** let a configured browser origin call /v1
- **admin:** auto-refresh the request logs, held while you are reading them
- **admin:** let the operator choose how often Overview re-reads itself
- **admin:** share one poll scheduler and stop polling a hidden tab
- **admin:** say where a key goes, and let every line be copied

### Fixed

- **repo:** drop the node_modules symlink and close the rule that let it in
- **admin:** give the control the same press and focus feedback on both pages
- **site:** stop the landing page from faking its own output
- **docs:** correct the three remaining false statements
- **onboarding:** make the documented path reach a working request
- **docs:** stop naming unrelated projects in public sample data
- **security:** close the three gaps a stranger can reach

  None of the three is in the service you run, and no instance needs upgrading for them: the
  issue chooser now routes a vulnerability report to the private advisory form instead of a
  public issue, the secret guard's pattern can finally match this project's own key format, and
  a missing `.dockerignore` had been leaving a host token in the dev container's build context
  that nothing copied. No advisory is owed.
- **admin:** keep the Logs filter row from being sized by its own data

### Changed

- **admin:** the key row's Edit, Rotate and Delete are icons, which gives the Limits column the
  width an origin list needs. Every action keeps an `aria-label`; delete keeps its error colour
- **test:** compress the NOT_OURS note to two lines

### Documentation

- say how to call SheLLM from a browser
- cut what was duplicated and signpost what is not product documentation
- **adr:** retire the PWA audit into the decision it produced
- **architecture:** describe the modules that exist
- describe the deployment and the numbers that exist

### Testing

- gate the four drift classes this audit found


## [1.9.0] - 2026-09-23

### Added

- **admin:** tell the operator where to send the key it just created
- **cli:** write the load knobs into the config init creates

### Changed

- **load:** raise the default concurrency to 4 and the global limit to 60

  **This moves a running install.** `MAX_CONCURRENT` and `MAX_STREAM_CONCURRENT` go from 2 to 4
  and `SHELLM_GLOBAL_RPM` from 30 to 60 on the next restart, unless your config file already sets
  them — a value you set by hand is never touched. Four CLI processes cost 150–215 MB each, so
  budget for roughly 860 MB at the cap instead of 430 MB. Nothing else about the queue changed:
  requests past the cap still wait, and past `MAX_QUEUE_DEPTH` they still get a 429.

  `shellm init` now writes the three into the config file when they are absent, so running it once
  after the update turns them into values you can see and edit rather than defaults you have to
  read the source for.

### Maintenance

- **deps-dev:** bump eslint from 10.10.0 to 10.11.0
- **deps:** bump dotenv from 18.0.0 to 18.0.1


## [1.8.0] - 2026-09-21

### Added

- **scripts:** decompose request latency from the log instead of benchmarking it
- **site:** add landing crops cut from the admin exports

### Fixed

- **health:** report a logout as a logout, not as an unknown
- **admin:** let the alpha modifier reach the theme colours
- **codex:** carry the cache token counters into the request log
- **admin:** put an expanded log detail under the row it belongs to
- **changelog:** clear the Unreleased block the generator would orphan
- **cli:** validate SHELLM_REF before it reaches git
- **site:** collapse the API reference's duplicate SheLLM mark (#82)
- **changelog:** drop the hand-written Unreleased entry the generator would orphan
- **db:** run migrations one statement at a time
- **site:** render the landing screenshots at a size someone can read

### Documentation

- **benchmarks:** price CLAUDE_CONFIG_DIR, and find the reason not to pull it
- **adr:** drop the warm pool, and say why it was never the shape here
- **benchmarks:** measure the warm pool on the server, and drop it
- **design:** replace the three audits with a finding ledger
- **agents:** issues live here, and they mean work in flight
- **contributing:** describe the release flow the workflow implements
- point decision 4 at the server run that already measured it
- **agents:** say plainly that no work is tracked as an issue here


## [1.7.0] - 2026-09-20

### Added

- **site:** rebuild the landing page around the screenshots

### Fixed

- **site:** stop the API reference logo filling the sidebar and colliding with the home link
- **admin:** precache the wordmark, so the offline shell is not broken (D47)
- **admin:** stop System reporting a health read that never happened (D46)

### Documentation

- **design:** record what the landing audit's findings turned into
- **design:** correct the README's claim that the public surface does not exist
- **experts:** seat S8 for brand and positioning
- **design:** audit the landing page against the one it replaced
- **design:** reject motion on the degraded banner, and correct a prediction

### Maintenance

- **deps:** bump sonarsource/sonarqube-scan-action from 8.2.1 to 8.2.2
- **deps:** bump dotenv from 17.4.2 to 18.0.0
- **deps-dev:** bump @redocly/cli from 2.53.2 to 2.53.3


## [1.6.1] - 2026-09-20

A recovery release. v1.6.0 took a `better-sqlite3` major whose releases publish no prebuilt
binary, so installing it compiles from source and fails on any host without a C++ toolchain.
Nothing else in this release.

**A host whose update to v1.6.0 failed has no `node_modules` at all** — `npm ci` removes them
before it installs, so the compile failure left nothing behind. `shellm update` cannot recover
that host: it snapshots the database before it touches anything, and the snapshot needs
`better-sqlite3`. It will refuse and stop. Re-run the provisioning script from a clone instead:

```bash
ssh root@your-server 'bash -s' < scripts/setup/vps.sh
```

It checks out the newest tag and reinstalls the dependencies, and it leaves the database and
`~/.config/shellm/env` untouched.

### Fixed

- **deps:** revert better-sqlite3 to 12.11.1, the last release that ships a binary
- **release:** stop the changelog dropping commits it does not recognise

### Maintenance

- **deps:** stop dependabot proposing a better-sqlite3 major on its own


## [1.6.0] - 2026-09-20

### Added

- **admin:** give the Playground wait a clock (P1)
- **admin:** confirm the press on every click target (D26)
- **admin:** name the motion scale, and give the toggle the curve it never chose
- **admin:** make the bare domain an entry point, not a dead end
- **admin:** say on the System page that the dashboard installs (P12)
- **site:** rebuild the landing page around what SheLLM actually is
- **admin:** give the sign-in page the CRT treatment, and the app's frame
- **admin:** let Errors lead the page on severity, not on presence
- **admin:** say when the Overview was last read, where it is read
- **admin:** give the hung request a home
- **admin:** extend the verdict pattern past the two places that had it
- **admin:** move refresh next to the other log actions
- **admin:** say how long ago an error was, not only when
- **admin:** put both charts on one time axis, marked at the present
- **admin:** render every timestamp in one configured timezone
- **admin:** drop the period selector for the one window there is

### Fixed

- **admin:** let the Playground say it could not read the model list (D16)
- **admin:** one icon set, and a maskable icon that is actually maskable
- **admin:** land at the top of a page, and stop spinning off screen
- **admin:** stop the queue bar from animating a measurement (D21)
- **admin:** honour prefers-reduced-motion (D25)
- **http:** answer an unmatched route in the format the caller asked for
- **admin:** keep the chrome out from under the status bar (P4)
- **admin:** correct the manifest and the worker's two soft spots (P6, P7, P9, P10, P13)
- **admin:** cache the stylesheet that declares the palette (P1)
- **admin:** raise the text that fell below AA
- **admin:** divide the burn rate by hours that actually happened
- **admin:** let the System page say what it could not read, and what it could not write
- **admin:** stop the log panels naming a period they do not measure
- **admin:** let the charts read the outline token instead of retyping it

### Changed

- **admin:** read the Logs summary before the table, not after it
- **admin:** declare the palette once, and name the five colours that had none

### Documentation

- close P3's residual and D18, both as decisions rather than as work
- **pwa-audit:** add P14, close P5, and decide P11 is not worth its weight
- **motion-audit:** close it out, and record where the work departed from it
- **motion-audit:** record what landed, and why the two tokens gate the rest
- say what you'd build with it, and draw where SheLLM sits
- **pwa-audit:** close P8 as 'it stays', and correct the entry that called it a choice
- **pwa-audit:** record what landed and why the rest has not
- **deployment:** say that an installed dashboard is not an offline app (P2)
- **readme:** show the dashboard, and cut the link nobody needed
- audit what the dashboard actually does when it is installed
- **changelog:** note that quota windows changed denominator
- **design:** record what the second pass actually landed
- **design:** second review pass, now that the exports exist
- **design:** commit the design audit the close-out work came from
- **changelog:** say what the dashboard rework asks of an operator

### Maintenance

- **deps:** bump better-sqlite3 from 12.11.1 to 13.0.3


### Upgrade notes

**`GET /` now sends a browser to the dashboard, and an unmatched route answers JSON.** The root
was never a route, so the bare domain served Express's own `Cannot GET /` page — and so did every
mistyped endpoint, including one under `/v1/`, to callers whose SDK parses JSON. A browser at the
root is now redirected to `/admin/dashboard/`, which lands it on the sign-in page when it has no
session; anything that did not ask for HTML gets a `404` carrying `not_found` in the same error
shape that endpoint already uses. Responses no longer carry `X-Powered-By`. An uptime check
pointed at `/` and asserting a 404 needs to point at `/health` instead.

**`GET /admin/stats` no longer accepts `?period=`, and answers with `window` instead of
`period`.** The dashboard offered 24h / 7d / 30d over a table the pruner already bounds at 30
days, so `30d` was every row that exists and the other two were narrower views of it — while each
option quietly gave every figure on the page a different denominator. There is now one window,
everything still in the database, and the page states it. The parameter is gone from the spec; a
request that still sends it is answered with the same single window rather than an error. If you
call this endpoint from anything other than the dashboard, read `window.from`, `window.hours` and
`window.retention_days` in place of `period`.

**Quota windows divide by observed time, and report it.** Each entry in `quota.windows` gains
`observed_hours`, and `cost_per_hour` and `requests_per_minute` divide by it rather than by the
nominal window. A gateway with eighteen hours of logs used to report its 7d burn rate as the
week's spend spread over a hundred and sixty-eight hours, most of which never happened — roughly a
tenfold understatement. `hours` still reports the window that was asked for, so a caller wanting
the old denominator can compute it. The dashboard's label follows the number: a window that did
not fill says the span it covered.

**The p95 latency card no longer shows a delta against the previous period.** Comparing meant
reading the window behind the current one, which retention has already deleted by the time anyone
looks. The arrow is removed rather than rebased onto an invented baseline.

**Timestamps now render in a configured timezone, not the browser's.** `SHELLM_TZ` names it and
defaults to `America/Mexico_City`; an unknown zone name falls back to that default instead of
failing the request. This affects every time the dashboard draws — tables, tooltips and both
charts' axes — so times will move for anyone whose machine was not already on that zone. Server
logs are unchanged and stay UTC.

## [1.5.0] - 2026-09-20

### Upgrade notes

**A bare `codex` now names a model, where before it named none.** Without `-m` the CLI reads
`~/.codex/config.toml`, and a ChatGPT account answers `The 'gpt-5.4' model is not supported when
using Codex with a ChatGPT account` to what it usually finds there — so `codex`, the only codex
name the API advertised, was the one that could not run. It now resolves to whichever model the
CLI itself reports as its default, read from `src/catalog/models.json`. On the catalog shipped
with this release that is `gpt-6-astra`. If your host wants a different one, name it explicitly
(`codex-gpt-5.6-sol`) or regenerate the catalog against your own binaries:

```bash
npm run catalog:build   # writes src/catalog/models.json from the CLIs installed here
```

That file is a floor, not the truth: the service asks your installed CLIs first and only falls
back to it, and the dashboard's playground says which of the two answered.

**The dashboard now tells you when it could not read, and it used to tell you the opposite.**
An unreachable gateway made the logs table say `No logs found`, the keys table say `No keys created
yet`, the queue read `0 / 0`, and the sidebar go on reporting `UP` with a frozen uptime and a
pulsing dot. All of those are now distinct from "nothing happened": a banner says the connection is
down, the sidebar says `UNREACHABLE`, and each table says which read failed. If your admin screens
look alarming after upgrading, read them — they may have been lying before.

**`GET /admin/dashboard/index.html` now requires a session.** The page lived under the static
mount, which sits ahead of the auth middleware, so that exact URL served the admin shell to anyone
who asked. It carried no account data, but it disclosed the dashboard. Anything pointing at the
filename — a bookmark, an uptime check — gets a 401 now; point it at `/admin/dashboard/` instead.

**`codex-gpt-5.5` retires on 2026-10-14.** The provider reports it and the playground now warns,
naming `codex-gpt-5.6-sol` as the replacement. Nothing breaks before that date.

### Added

- **models:** read the model catalog out of the CLIs instead of a list someone maintains
- **admin:** let every table say it could not read, and bring Logs onto the system
- **admin:** give the sign-in page the product's palette and a way out of a lockout
- **admin:** say when the dashboard could not ask

### Fixed

- **models:** stop advertising names that cannot run
- **ci:** let the coverage run create the directory it writes into
- **admin:** answer /stats with one shape, database or not
- **admin:** hold the update button until the run ends, then reload the page
- **admin:** a finished update no longer reads as NaN/NaN NaN:NaN:NaN

### Changed

- **admin:** put what broke above how much went through
- **admin:** declare the status scale, the mono stack and icon sizes once
- **admin:** compose the dashboard from per-page partials

### Documentation

- **adr:** record why the model catalog is read from the CLIs
- **models:** how to name one, and what a validation run actually proved
- link the API contract from the files a reader opens
- **api:** make the spec describe the server that actually ships

### CI

- measure coverage on every pull request, and lint a spec nobody was linting


## [1.4.0] - 2026-09-20

### Upgrade notes

**`shellm backup` is the answer to "how do I back this up", and it replaces any job that copied
the database by hand.** It writes the database and the config file into one timestamped directory
under `/var/lib/shellm/backups`, keeping the newest 7, using SQLite's online backup — a `cp` of a
WAL database is not a backup. Point whatever you already use at that directory and retire anything
that hardcoded `/home/shellmer/.shellm/shellm.db`: a release that moved it would have left that
job reporting successful backups of nothing.

**A snapshot contains your secrets.** `config.env` is the config file, with the admin password and
the CLI OAuth tokens in it. Both files are `0600` and the directory is `0700`; keep them that way
wherever you copy them to.

**The nightly timer ships switched off, and this upgrade does not install it.** `shellm update`
re-installs the system files the *previous* release knew about, and v1.3.0's updater has never
heard of `shellm-backup.service` or `shellm-backup.timer`. Re-run `scripts/setup/vps.sh` once to
put them in place, then decide whether to arm it:

```bash
sudo systemctl enable --now shellm-backup.timer   # or leave it off and call `shellm backup` yourself
```

The backup *directory* needs no such step — `shellm update` creates it the first time it takes a
snapshot.

**Updating over SSH now takes a snapshot too.** `sudo shellm update` snapshots before the checkout
and refuses to go on without one, because migrations only go forward. Until now only the
dashboard's path did. The update *into* this release is still carried out by v1.3.0's updater, so
it is the last one that takes none.

### Added

- **deploy:** ship the backup units, installed and switched off
- **cli:** shellm backup writes one verified snapshot into one directory

### Changed

- **update:** take the snapshot in the CLI, not in the root runner

### Documentation

- **deployment:** how to back up, and how to restore
- **adr:** a consistent snapshot is a command, and the contract is a directory


## [1.3.0] - 2026-09-20

### Upgrade notes

**The dashboard's update button arrives in this release**, and it stays inert until the trigger
is armed: `sudo systemctl enable --now shellm-update.path`. The System page distinguishes the two
ways it can be off — a unit that was never installed, which `scripts/setup/vps.sh` fixes, and one
installed and deliberately disabled, which `systemctl enable --now` does — because the remedies
differ and `systemctl is-active` reports `inactive` for both.

**Check `/var/backups/shellm` if a 1.2.0 host ever ran an update.** That release's updater created
the directory with `install -d -o shellmer`, which also takes over one that already exists, so on
a host where something else had provisioned it the owner silently changed. This release stops
using the directory, but nothing changes its ownership back: run `ls -ld /var/backups/shellm` and
restore it by hand if it reads `shellmer` where you expect root. Note that the upgrade *into* this
release is still carried out by 1.2.0's updater, so it leaves one last snapshot there; everything
after it lands in `/var/lib/shellm/backups`.

### Added

- **admin:** the update button, which asks rather than acts — the System page moves the host to a
  newer release by writing `/run/shellm/update-request.json` and stops there; the root unit does
  the rest, or nothing does. The endpoint's job is mostly to refuse, and each refusal matches a
  way a host could end up on a release nobody chose: anything that is not a `vX.Y.Z` tag, a target
  that is not newer, a major jump without the version typed out, a second request while one is
  already pending, and a trigger that is not armed.

### Fixed

- **deploy:** take the update snapshots out of `/var/backups/shellm` — the updater created that
  directory with `install -d -o shellmer`, which also applies to a directory that already exists,
  so on a host where something else had provisioned it as root-only the updater silently handed
  it to the service user. Snapshots now go to `/var/lib/shellm/backups`, which this project
  creates and owns, and retention only matches the runner's own file names.
- **admin:** serve the dashboard's own files relative to their directory — `res.sendFile` was
  given an absolute path, and `send` refuses any path holding a dot-directory, so the page, the
  manifest and the service worker all answered 404 when the checkout sat under one.

### Documentation

- **deployment:** make the documented manual database backup work, and prove its own result — it
  read the database through `~`, which the calling shell expands to *its own* home before `sudo`
  runs, so it failed and left an empty file behind while the unchained `mv` on the next line moved
  those zero bytes over the previous backup. The commands are now chained, take absolute paths,
  and check the copy is non-empty and passes `integrity_check` before anything is overwritten —
  both checks, because an empty file is a valid empty SQLite database that `integrity_check`
  answers `ok` for.

## [1.2.0] - 2026-09-20

### Upgrade notes

**Re-run `scripts/setup/vps.sh` once after this update.** An upgrade is performed by the updater
of the release you are leaving, and that one only re-installed `shellm.service`. The systemd
units, the `tmpfiles.d` entry and the updater script this release adds therefore do not arrive
with it. From the next release onwards `sudo shellm update` keeps the whole set in step on its
own, and never enables anything.

The dashboard's update button is **not** in this release — only the privileged half it will use.
That half stays inert until you opt in with `sudo systemctl enable --now shellm-update.path`.

### Added

- **deploy:** the privileged half of the update button
- **admin:** a playground that calls /v1 with a client key
- **admin:** say what failed and what the runtime is doing
- **keys:** show what a key has spent, and let its limits be edited
- **logs:** record what a request asked for and why it failed

### Fixed

- **deploy:** make the updater report the failures it cannot survive
- **admin:** send an expired session to the login page, not a Basic prompt

### Documentation

- **deployment:** make `shellm update` the documented way to upgrade


## [1.1.1] - 2026-09-19

### Fixed

- **admin:** allow the release check the dashboard's own CSP was blocking

### Documentation

- **adr:** decide the privilege split for the update button


## [1.1.0] - 2026-09-19

### Breaking Changes

- **A host now follows published releases, not a branch.** `vps.sh` checks out the newest tag
  and leaves the checkout detached, so on an existing install `git pull` stops updating
  anything — it reports success and changes nothing. Upgrade by re-running `vps.sh`, or with
  `shellm update`, which resolves the same ref. `SHELLM_REF` pins a specific release, or a
  branch on purpose.

### Added

- **setup:** install codex on the host, pinned to CODEX_VERSION
- **setup:** deploy a published release instead of a branch tip

### Fixed

- **admin:** read shared state from the scope, not from $root — the dashboard's version, uptime,
  status and queue panels were reading an element instead of the data, and showed empty or zero
- **health:** serve the real status and the CLI versions from the poller's cache — `/admin/health`
  reported `ok` regardless of provider state, so anything trusting it as a health signal was
  trusting a constant
- **release:** stop CI from opening the pull request, and surface the breaking changes

### Documentation

- **adr:** correct the threat this decision was argued from

### CI

- fail the audit on advisories, not on the registry being down


## [1.0.0] - 2026-09-19

### Breaking Changes

Upgrading from `0.5.0` meets all of these at once. None of the commits behind them carried a
`!` marker, so they are recorded here by hand.

- **Gemini is gone.** The provider was removed after Gemini CLI stopped serving personal Google
  plans; requests naming a gemini model now fail.
- **The generic HTTP provider and Cerebras are gone.** SheLLM drives CLI subprocesses only.
- **The models table was dropped.** Model names map to CLI aliases in code, so a model added by
  editing the database is no longer recognised.
- **Configuration moved out of SQLite** into `~/.config/shellm/env`. Settings written to the
  database are ignored; the migration drops that table.
- **The prompt injection guard was removed.** SheLLM does not inspect prompt content — isolating
  what the CLI can reach is the defense that works.
- **The dashboard was trimmed** to keys, logs and provider status; the models page it used to
  carry no longer exists.

### Added

- **admin:** report the running build and let a provider be paused
- **service:** stop the service from writing the code it runs
- **claude:** run one-shot requests with the CLI's internal tools off
- **admin:** rebuild the overview around capacity, latency and usage
- **admin:** aggregate capacity, latency layers and per-model usage
- **codex:** pass the model, sandbox the run, and serialize the CLI
- **claude:** stop the CLI from inheriting the operator's setup
- **bench:** measure time to first text, and re-measure one scenario
- **bench:** add a capability and latency runner for a live instance
- **admin:** make the dashboard installable on a phone
- **admin:** sign in on a login page instead of the browser dialog
- **setup:** slim vps.sh down to provisioning and add vps-uninstall.sh
- **cli:** add shellm init
- **cli:** add shellm doctor
- **providers:** pass CLAUDE_CODE_OAUTH_TOKEN to the claude CLI
- **providers:** pass the requested model to the CLI

### Fixed

- **health:** probe with a free command and stop guessing a logout
- **metrics:** record every billable token and the CLI's own timings
- **errors:** answer /v1 errors in the format the caller speaks
- **claude:** stream the CLI's tokens instead of flushing at the end
- **health:** probe providers with their own environment
- **test:** drop gemini from the CLI contract suite
- **cli:** make shellm status work against the minimal /health
- **api:** list only models that map to a CLI model in /v1/models
- **config:** read configuration from ~/.config/shellm/env
- **providers:** run each CLI in its own temporary directory
- **server:** bind to 127.0.0.1 by default
- **devcontainer:** trust the workspace mount for git
- **devcontainer:** regenerate from the baseline templates with local.env
- **providers:** stop passing temperature flags the CLIs reject
- **devcontainer:** resolve node_modules permissions and rename service to workspace

### Changed

- drop the Gemini-only health heuristic

### Documentation

- **adr:** decide how releases are cut, deployed and applied
- describe the probe the providers now own
- **audience:** record knowing the quota as a need of its own
- publish the codex measurement and correct what the docs claimed
- **benchmarks:** publish the flag measurement, including the nil result
- **api:** describe /v1 errors in the caller's format
- **guides:** correct the streaming finding and refresh the guides
- **guides:** add a usage guide and the first production benchmark
- regroup .env.example and drop the settings nothing reads
- point VERSIONS.md at vps.sh instead of the deleted Dockerfile
- correct the architecture guide and drop the served landing page
- update the contributor guide and the seed script
- rewrite the deployment guide for the current setup
- **api:** align the OpenAPI spec with the real surface
- rewrite the README around what SheLLM does today
- replace ROADMAP.md with ADR-0001 and refresh the agent instructions
- state the fair-use position on provider subscriptions
- move work tracking to the private project board
- rewrite identity and expert panel around a new audience doc
- add .notdefined.yml project metadata

### Maintenance

- **scripts:** convert release-changelog to CommonJS
- **lint:** lint the scripts directory
- remove Docker, the landing page and the screenshot tooling
- **setup:** replace dev.sh and check-env.js with init and doctor
- remove the unused .notdefined.yml
- **deps:** refresh transitive dependencies with npm update
- allow better-sqlite3's install script
- **devcontainer:** add the Pencil extension and commit the lockfile
- **docker:** bump gemini-cli to 0.60.0 and codex to 0.154.0
- **deps:** update dependencies to their latest releases
- ignore only the local agent and devcontainer files
- **devcontainer:** align with the shared baseline

### Testing

- **admin:** assert the CSV export against the stored columns
- **providers:** keep every configured variable out of the CLI env
- **cli:** check provider arguments against the real CLI binaries

### CI

- **release:** cut a release from a dispatch instead of seven local steps
- bump the GitHub Pages actions to their Node 24 majors
- run every workflow on Node 24 with the v7 actions
- add the security and quality gate
- name the test job and bound its runs


## [0.5.0] - 2026-03-25

### Added

- **admin:** sidebar with uptime, health endpoint, and docs links

### Fixed

- **test:** use standard API ID formats and fix all failing tests
- **stream:** prevent zombie slots and fix headers-after-flush crash
- **cli:** use npm run migrate and remove unused import

### Changed

- organize scripts/ with setup/ subfolder and release- prefixes
- move v1/ to api/v1/
- extract app.js from server.js
- split db/index.js by domain and co-locate migrations
- extract infra/ and routing/ from God modules

### Documentation

- add architecture guide with module overview and request flow


## [0.4.1] - 2026-03-24

### Added

- **cli:** add shellm update command for easy VPS deploys
- **auth:** support x-api-key header for Anthropic SDK compatibility

### Fixed

- **cli:** run git commands as shellmer to avoid safe.directory error
- **compat:** align streaming format, IDs, and model names with upstream APIs
- **docs:** serve API docs from /docs/ endpoint on VPS

### Documentation

- **deployment:** simplify update instructions and add alias tip


## [0.4.0] - 2026-03-24

### Added

- **admin:** separate CLI/API provider sections with templates
- **providers:** generic HTTP provider engine + CRUD from admin UI
- **admin:** complete settings system with Tier 2/3 and category grouping
- **admin:** add model CRUD controls to provider cards
- **admin:** add hot-reloadable settings system
- **admin:** normalize providers and models into database
- **compat:** improve OpenAI and Anthropic API compatibility
- **security:** per-client safety profiles with X-SheLLM-Safety header
- **security:** add prompt injection guard middleware
- **site:** add subtle animations to GitHub Pages landing

### Fixed

- **service:** add CLI paths to systemd PATH
- **scripts:** clarify .env path in post-setup instructions
- **scripts:** clarify user context in post-setup steps and fix port
- **scripts:** clean up root-level CLI installs before shellmer setup
- **scripts:** install LLM CLIs as shellmer user with npm prefix
- **scripts:** use HTTPS for git clone in VPS setup
- **admin:** make settings values look like editable inputs
- **admin:** unify toggle switches across dashboard
- **security:** hardening fixes
- **security:** important security fixes
- **security:** critical security hardening
- **security:** harden subprocess env to prevent credential leakage
- **lint:** resolve 7 eslint errors breaking CI
- **release:** auto-update version in site/index.html during npm version
- **docs:** update landing page version to v0.3.0

### Documentation

- **deployment:** fix port references (6000→6100), add FAQ section
- **guides:** add VPS deployment guide and improve Getting Started
- **guides:** add API compatibility guide for OpenAI and Anthropic
- **guides:** add prompt safety guide for developers
- **security:** update documentation for security hardening
- **readme:** update supported models list with all current model aliases

### Maintenance

- ignore plan files


## [0.3.0] - 2026-03-23

### Added

- **admin:** add Terminal page with live server output stream
- **admin:** add Live Logs page with terminal-style real-time feed
- **admin:** add live log stream endpoint with event emitter
- **admin:** redesign models page to match design mockup
- **admin:** redesign request logs page with stats summary and improved UX
- **admin:** add sparkline charts, auto-refresh, and cost burn rate to overview
- **admin:** add client description, audit log with UI activity panel
- **dx:** add SQL migrations system and architecture diagram
- **api:** add response_format and top_p parameter passthrough
- **dx:** add pre-commit lint hook and npm run seed for demo data
- **admin:** add error rate and cost-by-provider widgets to overview dashboard
- **admin:** add expires_at display and input to keys UI
- **resilience,streaming:** complete backlog items 5 & 6
- **dx:** add ESLint with flat config, npm audit in CI, fix all lint errors
- **admin:** add error rate breakdown and cost by provider to /admin/stats
- **health:** add webhook alerting on provider health transitions
- **auth:** add key expiration with expires_at field
- **api:** add temperature parameter passthrough to all providers
- **admin:** add Playground page with streaming, redesigned sidebar, and page headers
- **streaming:** add SSE streaming for /v1/chat/completions with client disconnect handling
- **health:** add startup health gate, background poller, and Gemini keychain fix
- **admin:** add CSV log export with filtering and formula injection protection

### Fixed

- **admin:** replace text logo with SVG assets and add SVG favicon
- **db:** replace non-sequential 001b migration with idempotent 004
- **db:** handle pre-existing DBs in migration runner, fix sparkline height
- **security:** improve secret redaction to catch short API key patterns
- **health:** add --approval-mode yolo to Gemini deep check and handle yolo stderr warnings
- **auth:** always require Bearer token, update tests, backlog, and CLAUDE.md
- **screenshots:** replace Puppeteer with Playwright and fix font loading
- **readme:** use SVG logos and add screenshot generation script
- **docs:** fix API docs paths for GitHub Pages and update landing page
- **ci:** update Pages workflow to use modular OpenAPI spec and client-side Redoc

### Documentation

- **backlog:** update #1 Models Page with expert review and current status
- **backlog:** mark #7, #9, #12 as Done
- **backlog:** update status for expires_at UI, dashboard widgets, response_format, seed, redaction
- **backlog:** update status for temperature, key expiry, webhook, error rate, ESLint, npm audit
- **backlog:** add Admin Playground (#14) and quick reference table


## [0.2.0] - 2026-03-22

### Added

- **branding:** replace text wordmarks with inline SVG logo across all surfaces
- **assets:** generate PNG favicons from SVG using sharp
- **assets:** add SVG logos and favicon extracted from Stitch design
- **runtime:** apply terminal_core tokens to server splash page
- **admin:** redesign dashboard with terminal_core dark theme
- **pages:** redesign GitHub Pages with terminal_core spec
- **community:** add issue templates, PR template, CODEOWNERS, and README badges
- **release:** adopt conventional commits and automate CHANGELOG + GitHub Releases
- **dx:** add check:env script and setup-dev.sh onboarding guide
- **docs:** add Redocly dark theme config and custom HTML template
- **pages:** add GitHub Pages site with CI deploy workflow

### Fixed

- **admin:** fix favicon 404s and Alpine expression errors on dashboard
- **assets:** tighten wordmark SVG viewBox to 264x64
- **assets:** restore favicon PNG fallbacks with new filenames across all surfaces

### Changed

- **docs:** modularize OpenAPI spec into docs/api/ with client-side Redoc

### Documentation

- Add BACKLOG.md file to track upcoming changes
- **redesign:** add BACKLOG.md and redesign implementation plan
- **guides:** add branding.md — step-by-step design and branding guide
- **guides:** add releasing.md — step-by-step release guide
- expand expert panel with permanent/situational roles and add comparison section

### Maintenance

- **docs:** move EXPERTS.md and IDENTITY.md into docs/ and update AGENTS.md
- update Material Symbols font URL parameters
- **assets:** replace PNG favicons with icon-color SVG favicon
- remove legacy branding/ directory
- **assets:** migrate to assets/ structure — Phase 1 of redesign


## [0.1.0] - 2026-02-27

First public release. SheLLM turns CLI subscriptions and API providers into a
single REST API — one interface, any provider.

### Added

- **Core service** — Express server with provider abstraction, in-memory queue
  (max 2 concurrent, max 10 depth), and 120s subprocess timeout.
- **Providers** — Claude Code CLI, Gemini CLI, Codex CLI (subprocess-based),
  Cerebras (HTTP API). Per-provider enable/disable toggle.
- **OpenAI-compatible endpoint** — `POST /v1/chat/completions` and
  `GET /v1/models` for drop-in compatibility with any OpenAI SDK.
- **Anthropic-compatible endpoint** — `POST /v1/messages` for Claude Code and
  Anthropic SDK compatibility.
- **Model aliases** — `SHELLM_ALIASES` env var maps custom names to providers
  (e.g. `{"gpt-4":"claude"}`).
- **SQLite persistence** — `better-sqlite3` with WAL mode for API key storage
  and request logging. Auto-prune after 30 days.
- **API key management** — Admin CRUD API for bearer token auth. SHA-256 hashed
  keys, runtime create/rotate/revoke without restart. Auth disabled when no
  keys exist.
- **Per-key model restrictions** — Optional `models` whitelist per API key.
- **Rate limiting** — Per-key RPM limits with `Retry-After` header.
- **Admin dashboard** — Browser SPA at `/admin/dashboard/` (Alpine.js v3 +
  Tailwind CSS 4, no build step). Pages: Overview (provider health, queue
  stats, metrics), Request Logs (filterable, paginated), API Keys (full CRUD),
  Models (per-provider listing).
- **Token usage extraction** — Parse token counts and cost from Claude and
  Gemini CLI output.
- **Queued time tracking** — `queued_ms` exposed in API responses and dashboard.
- **Admin auth hardening** — Rate-limited login (5 attempts, 5-min lockout),
  timing-safe password comparison, security headers.
- **`shellm` CLI** — `start`, `stop`, `restart`, `status`, `logs`, `version`,
  `paths` commands. Daemon mode with PID file.
- **Structured logging** — JSON logger with `LOG_LEVEL` filtering and logrotate
  config.
- **API hardening** — Input validation, 256KB body limit, 50K prompt cap,
  Content-Type enforcement, graceful shutdown (30s drain).
- **Observability** — `X-Queue-Depth`/`X-Queue-Active` headers, `duration_ms`
  in errors, health endpoint with provider status.
- **Health endpoint** — `GET /health` with provider checks, queue stats, uptime.
- **OpenAPI 3.1 spec** — Machine-readable API documentation at `/docs/`.
- **Public landing page** — Overview page at `/` with links to docs and dashboard.
- **Branding** — Logo, favicon assets, and style guide.
- **Deployment** — systemd service, cloudflared tunnel, VPS provisioning script
  (`scripts/setup-vps.sh`).
- **Smoke test suite** — `npm run smoke` for automated provider health checks.
- **Test suite** — 180+ tests across 28 files using `node:test` + `supertest`,
  runs in under 1 second.

[Unreleased]: https://github.com/rodacato/SheLLM/compare/v1.26.0...HEAD
[1.26.0]: https://github.com/rodacato/SheLLM/compare/v1.25.0...v1.26.0
[1.25.0]: https://github.com/rodacato/SheLLM/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/rodacato/SheLLM/compare/v1.23.0...v1.24.0
[1.23.0]: https://github.com/rodacato/SheLLM/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/rodacato/SheLLM/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/rodacato/SheLLM/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/rodacato/SheLLM/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/rodacato/SheLLM/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/rodacato/SheLLM/compare/v1.17.1...v1.18.0
[1.17.1]: https://github.com/rodacato/SheLLM/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/rodacato/SheLLM/compare/v1.16.1...v1.17.0
[1.16.1]: https://github.com/rodacato/SheLLM/compare/v1.16.0...v1.16.1
[1.16.0]: https://github.com/rodacato/SheLLM/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/rodacato/SheLLM/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/rodacato/SheLLM/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/rodacato/SheLLM/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/rodacato/SheLLM/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/rodacato/SheLLM/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/rodacato/SheLLM/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/rodacato/SheLLM/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/rodacato/SheLLM/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/rodacato/SheLLM/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/rodacato/SheLLM/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/rodacato/SheLLM/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rodacato/SheLLM/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/rodacato/SheLLM/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/rodacato/SheLLM/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/rodacato/SheLLM/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/rodacato/SheLLM/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/rodacato/SheLLM/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rodacato/SheLLM/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/rodacato/SheLLM/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/rodacato/SheLLM/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/rodacato/SheLLM/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rodacato/SheLLM/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rodacato/SheLLM/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rodacato/SheLLM/releases/tag/v0.1.0
