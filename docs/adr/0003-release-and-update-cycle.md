# ADR-0003 — The running build identifies itself, arrives by tag, and is replaced by a component the service cannot become

- **Status:** accepted
- **Date:** 2026-09-19
- **Amends:** ADR-0001's deployment description. Supersedes the manual upgrade documented in
  `docs/guides/deployment.md` and the seven-step local release in `docs/guides/releasing.md`,
  both of which stay in force until the pieces below ship.

## Context

Four facts, all measured on the only real instance on 2026-09-19, not impressions:

- **Releases stopped happening.** 76 commits since `v0.5.0`, which was tagged 2026-03-25.
  `package.json` still says `0.5.0`, `## [Unreleased]` is empty, and the release procedure is
  seven manual steps in a guide. A process that only runs when someone remembers does not run.
- **A tag changes nothing today.** `scripts/setup/vps.sh` clones the default branch and upgrades
  with `git pull --ff-only`. The host follows `master`, so a tag is a changelog entry that has no
  bearing on what executes.
- **The running service cannot say what it is.** `GET /health` answers `{"status":"ok"}`.
  `/health/detailed` reports providers, circuit breakers, queue and uptime — but no version, no
  commit, and no CLI versions. The host once ran 52 commits behind for months and nothing said so.
- **The service can rewrite the code it runs.** Everything in the service — the Node process and
  every CLI it spawns — runs as `shellmer`, which owns `/home/shellmer/shellm`. `shellm.service`
  carries `Restart=on-failure` with `RestartSec=5s`, so a crash that the same uid is allowed to
  cause reloads whatever is on disk five seconds later. The human restart that was assumed to be
  the control is not one.

The last fact is the load-bearing one for the decision below. **How it was first written here was
wrong, and the correction matters more than the original claim:** this ADR argued that a prompt
injection could write to `src/`, which it cannot. [ADR-0002](./0002-cli-internal-tools-off.md),
accepted the same day, gives every request `--tools ''`, `--permission-mode dontAsk` and
`--settings '{"disableAllHooks":true}'` — the model has no file, shell or web tool, and no hooks
run. There is no known path today from a request to a write.

So part 1 is not closing an exploitable hole. It narrows what a compromise of the service process
can reach, and it removes a step that a future agentic endpoint would restore — ADR-0002 says
such a feature supersedes it rather than flipping the flag, and the day it lands, an unconfined
checkout is a real hole rather than a theoretical one. That is a good reason to have done it, and
a different one from the reason first given.

## Decision

Five parts of one cycle. Each is separately shippable; the order is the order they are listed.

### 1. The service cannot write the code it runs

`shellm.service` — the unit this repository ships, not a private override on one host — gains:

```ini
ProtectSystem=strict
ReadWritePaths=/home/shellmer -/run/shellm
ReadOnlyPaths=/home/shellmer/shellm
PrivateTmp=yes
NoNewPrivileges=yes
```

The checkout becomes read-only to the process that serves requests and to every CLI it spawns,
which breaks the write step of the chain above regardless of anything else in this ADR.

**The home directory is granted as a whole, not enumerated.** The CLIs write their state below it
on every request — `~/.claude/sessions/`, `~/.claude/cache/`, `~/.codex/` — and `~/.claude.json`
is a loose file rewritten by atomic rename, which needs its *parent* directory writable, meaning
`/home/shellmer` itself. Codex rewrites its OAuth token the same way. An earlier draft of this
decision tried to name the writable paths individually and would have broken provider
authentication on the first restart; the working shape is the inverse, granting the home and
carving the checkout back out of it.

`PrivateTmp=yes` keeps the per-request temporary directory working while isolating it from the
rest of the system. `/run/shellm` is writable because that is where the update request is placed
(part 5); `ProtectSystem=strict` makes `/run` read-only otherwise, so granting it is what lets
the button write anything at all.

The leading `-` on that path is load-bearing. systemd refuses to set up the mount namespace when
a `ReadWritePaths=` entry is missing, and `/run` is tmpfs, so the directory is gone after every
reboot unless the `tmpfiles.d` entry is installed. Without the dash, an install that copied the
unit but not the tmpfiles file gets a service that will not start, reported as a namespacing
error that names nothing useful. With it, the service starts and only the button is inert — the
failure degrades in the right direction.

Nothing in that block is specific to one machine, which is why it ships as the default rather
than as a drop-in: a private override would leave every self-hosted install on the weak setting.

### 2. The build identifies itself

`/health/detailed` reports the version from `package.json`, the short commit of the checkout, and
the version of each CLI it drives. The dashboard shows them, and compares the running version
against the latest published release, so "37 commits behind" is visible without an SSH session.

`GET /health` stays `{"status":"ok"}`: it is unauthenticated, and a build identifier is not
something to hand out.

### 3. Releases are cut by CI, not from a laptop

A `workflow_dispatch` job takes a bump level and runs `npm version`. The first release cut this
way is **`1.0.0`**: the repository is on `0.5.0`, and leaving `0.x` is what semver calls that,
whatever the prose around the revamp calls the product.

**Refined while implementing (2026-09-19):** this was written as CI pushing the commit and the
tag to the default branch. CI pushes a release branch instead, and a person opens the pull
request from it. The changelog entry is the thing people read before upgrading, and it needs a
human between generation and publication — a breaking change committed without its `!` marker
lands under `Changed` and only a reader can move it. Cutting `1.0.0` proved that on the first
run: six removals went out under `Changed` because no commit had marked them.

Actions does not open the pull request itself, because the repository setting that allows it
also allows Actions to *approve* pull requests, and a token-authored pull request runs no CI.
Publication is then decided from the manifest: a push to the default branch carrying a version
that has no tag is what tags and publishes. The existing tag-triggered `release.yml` then publishes the GitHub Release with the notes
that `scripts/release-changelog.js` generates from conventional commits. The decision to cut a
release stays human; the seven steps stop being.

### 4. The tag is the unit of deployment

`vps.sh` checks out the latest tag rather than the default branch, with `SHELLM_REF` as the
escape hatch for deploying a branch deliberately. This is what makes a release mean something,
and it only makes sense after part 3 — pointing at tags while tags are six months stale would
make the escape hatch the normal path, which is where this started.

### 5. Updating is a request the app makes, never an action it takes

The dashboard offers an update. It lists published releases with their notes, marks a major
version jump differently from a patch, and requires the target version to be typed for a major.
Pressing it **writes a request**; it does not deploy.

Two files carry the exchange, and the split is deliberate:

| | Path | Why there |
|---|---|---|
| Request | `/run/shellm/update-request.json` | tmpfs — a request that outlives a reboot would fire an unattended update at a time nobody chose |
| Result | `~/.shellm/update-status.json` | durable — the dashboard reads it *after* the restart, which is exactly when a rollback matters |

`/run/shellm` is created by `tmpfiles.d`, not by `RuntimeDirectory=` in `shellm.service`: systemd
removes a runtime directory when its unit stops, and the updater stops the service midway through
its own sequence. Both paths are a contract between the dashboard and the updater, so they are
documented here rather than left to whoever writes each half.

The updater is a root-owned script at a fixed path, not writable by `shellmer`, started by a path
unit — no `sudoers` entry exists:

```
shellm-update.path      (root)   watches /run/shellm/update-request.json
└─ shellm-update.service (root, Type=oneshot)
   └─ /usr/local/sbin/shellm-update
      ├─ validate the requested tag, then snapshot the database with SQLite's .backup
      ├─ runuser -l shellmer -c 'git fetch --tags && git checkout <tag> && npm ci --omit=dev'
      ├─ systemctl restart shellm
      └─ poll /health for 60s; on failure restore the previous tag and reinstall
      └─ write ~/.shellm/update-status.json either way
```

**Nothing touching the checkout runs as root, and no standing privilege is granted.** Running
`git` or `npm` as root inside a tree that `shellmer` owns hands root that user's code:
`.git/config` is writable by its owner and defines `core.hooksPath`, which this repository's own
`prepare` script already repoints at `scripts/`, so a planted `post-checkout` hook would execute
as root. Dropping to `shellmer` for those steps grants nothing new — that user already owns every
file involved. A `sudoers` entry for the restart was the first design and was dropped because it
hands `shellmer` a permanent capability that any process of that user can invoke, which
contradicts binding the privilege to a fixed sequence. The root-owned script *is* that sequence.

The mitigations for a root-side checkout were considered and rejected: `git -c
core.hooksPath=/dev/null` is a denylist to maintain, and `npm ci --ignore-scripts` does not work
here at all — `better-sqlite3` is the only dependency with an install script and it is a native
module, so skipping it leaves the service unable to open its database.

**The request file is untrusted input consumed by a root process**, which is the one place this
design concentrates risk. Checking the tag's shape and asking whether it exists is necessary and
not sufficient, because `shellmer` owns `.git`: it can point a local tag of the right name at any
commit, and it can move that ref between the fetch and the checkout. Validating a name and then
checking out that name reads as a check and is not one.

The requested tag is therefore resolved **to a commit id, against the remote, before any
checkout**, and the checkout takes the id:

```sh
url=https://github.com/rodacato/SheLLM.git     # literal, never the "origin" remote
case $tag in v[0-9]*.[0-9]*.[0-9]*) ;; *) refuse ;; esac

lines=$(git ls-remote --tags "$url" "refs/tags/$tag^{}")           # annotated tags
[ -n "$lines" ] || lines=$(git ls-remote --tags "$url" "refs/tags/$tag")
[ -n "$lines" ] || refuse                                          # no such tag
[ "$(printf '%s\n' "$lines" | wc -l)" -eq 1 ] || refuse            # ambiguous match
sha=$(printf '%s' "$lines" | cut -f1)

git fetch --tags --force "$url"
git checkout --detach "$sha"
```

A commit id cannot be hijacked: `shellmer` can create objects, not change which object a hash
names. The worst it achieves is naming one that does not exist, which fails the update — denial
of service, not execution. The rollback path resolves the previous tag the same way and is
recorded as an id, not a name.

Two details that make the difference between this working and only appearing to:

- **The remote is spelled out, not called `origin`.** `.git/config` belongs to `shellmer` and
  defines where `origin` points, so a script that fetches from `origin` lets the least
  privileged half choose the source. Part 1 already stops the service from writing there, but a
  root-side check should not depend on another control being correct.
- **The peeled lookup needs a fallback.** `refs/tags/<tag>^{}` only exists for annotated tags,
  and this repository's tags are lightweight — `v0.5.0` resolves to a commit directly, and the
  peeled refspec returns nothing for it. Without the second lookup the updater would refuse
  every tag the project has ever published, and the fallback stays even once new tags are
  annotated, because a rollback can target an old one.
- **An ambiguous or empty result is refused, not narrowed.** `ls-remote` patterns match by
  suffix and can return several lines, which `cut -f1` would silently concatenate into
  something that is not a commit id. The emptiness check is separate from the line count
  because `printf '%s\n' "" | wc -l` is 1: counting alone would accept "no such tag" as a
  single clean answer. When something does not add up the update fails, the same direction of
  failure as the `-` on `ReadWritePaths`.

Two failure modes worth writing down, because both look like working code:
`runuser -u shellmer` does **not** change `HOME` — it inherits root's, and `npm` would write to
`/root/.npm` — so the login form `runuser -l` is what the script uses. And the script sets an
absolute `PATH` and never sources anything from the checkout, which `shellmer` can write.

The script, both units and the `tmpfiles.d` entry ship in this repository beside `shellm.service`
and are installed by `vps.sh`. None of them contains anything specific to one machine, and a
self-hosted install that had to reinvent the privileged wiring would either go without the
feature or improvise something weaker. What stays with the operator is the decision to enable
them, the webhook URL, and their own backup schedule.

What makes this safe is not the mechanism but step 2: the updater deploys a published tag from
the remote, never the working tree. Code that a prompt injection wrote to `src/` is **discarded**
by an update rather than executed by it. The button is a recovery path, not the missing link in
an attack chain. The worst an attacker gains by writing the request file is a forced update to a
real published release, which is bounded further by refusing downgrades and unknown tags.

## Consequences

- The update button requires parts 2, 3 and 4 to exist first. It is the end of this cycle, not an
  alternative to it.
- Deployment was never the bottleneck — it is two commands and about thirty seconds. Part 5 buys
  convenience, not relief, and it is priced accordingly: it is last.
- A self-update has a failure mode the manual path does not: the button lives inside the service
  it restarts. Without the rollback in step 4, a bad release leaves no dashboard to fix it from,
  and `Restart=on-failure` retries the broken start every five seconds. The rollback is not a
  refinement of part 5; it is part of it.
- Database migrations do not roll back. The snapshot in step 1 is what makes an update
  reversible, and a major version jump is where that matters — which is why the dashboard marks
  those differently. It is distinct from, and does not replace, whatever periodic backup the host
  already runs: one is a synchronous pre-update snapshot, the other is a nightly safety net.
- **The database must never be backed up by copying the file.** It runs in WAL mode
  (`src/db/index.js`), so a `cp` of the `.db` yields a torn copy or one missing recent commits.
  Every backup path — the updater's and the operator's — uses SQLite's online `.backup`.
- Confining the checkout surfaces anything that writes inside it. Nothing does at runtime; `npm ci`
  does, and it is unaffected because the updater runs outside the unit's sandbox. A provider that
  stored state under the checkout instead of the home directory would be.
- Provider state transitions already emit to `SHELLM_ALERT_WEBHOOK_URL` and the variable is
  unset. Setting it is not part of this decision because no code changes; it is listed here
  because it removes more operational pain than anything above it and costs nothing.

## What was rejected

- **Giving the service `sudo systemctl restart shellm`.** It closes the write-to-execute chain in
  the attacker's favour. The conclusion survived the discovery that `Restart=on-failure` already
  closes it: the answer is to remove the write, not to normalise the restart.
- **Deploying from the app by pulling and reinstalling in-process.** Same objection, plus a
  service that rewrites itself while serving requests.
- **A new deployment tool or pipeline.** GitHub Actions is the orchestration layer and stays.
- **An SSH-based `workflow_dispatch` deploy, for now.** It matches the pattern used elsewhere and
  it is not rejected on merit — it is deferred, because the deployment it would automate is not
  the part that hurts.
- **A `/metrics` endpoint.** Nothing scrapes it today and an endpoint without a consumer is dead
  code. The provider-transition webhook covers the operational pain that was actually felt.

## What did not change

One host, one operator, one consumer. Nothing here assumes a fleet, adds a tool, or changes how
requests are served. The CLI binaries stay official and unmodified, and the service still binds to
loopback behind a tunnel.
