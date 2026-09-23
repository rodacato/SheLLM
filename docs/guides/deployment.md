# Deploying SheLLM on a server

SheLLM runs as a systemd service under its own user, bound to `127.0.0.1`. Nothing here is
specific to a hosting provider; it assumes a fresh Debian or Ubuntu machine you reach over SSH as
root.

**Before you start:** decide which account runs the CLIs. Whoever holds that login is what a
provider suspends if something looks automated — read the fair-use section in the
[README](../../README.md#fair-use-and-provider-terms) first.

## 1. Provision

```bash
ssh root@your-server 'bash -s' < scripts/setup/vps.sh
```

The script is safe to re-run. It creates the `shellmer` user, installs Node.js 24, installs Claude
Code pinned to `CLAUDE_VERSION` and Codex pinned to `CODEX_VERSION` (see
[`VERSIONS.md`](../../VERSIONS.md)), clones the repository to `/home/shellmer/shellm`, links the
`shellm` command, and installs the systemd unit, the logrotate config and the update trigger. It
does **not** start the service, does **not** enable the update trigger, and does **not** configure
a tunnel.

Both CLIs are installed as `shellmer`, not system-wide: Claude Code under `~/.local/bin` and Codex
under `~/.npm-global/bin`, the two paths the systemd unit puts on `PATH`.

**It installs the newest published release**, not the tip of the default branch, so the host runs
something with a version number and release notes. A repository with no tags yet falls back to the
default branch.

Override defaults with environment variables:

```bash
ssh root@your-server 'CLAUDE_VERSION=2.1.273 bash -s' < scripts/setup/vps.sh
ssh root@your-server 'CODEX_VERSION=0.154.0 bash -s' < scripts/setup/vps.sh
ssh root@your-server 'SHELLM_REF=v1.0.0 bash -s' < scripts/setup/vps.sh   # a specific release
ssh root@your-server 'SHELLM_REF=master bash -s' < scripts/setup/vps.sh   # or a branch, deliberately
```

## 2. Log the CLI in

The service user needs its own login. On a machine with no browser, use a long-lived token:

```bash
sudo -iu shellmer
claude setup-token        # complete the flow in any browser, then copy the token it prints
```

Keep the token for the next step. Codex, if you use it, authenticates with `codex login`; its
device flow is what works on a headless box.

## 3. Configure

```bash
sudo -iu shellmer shellm init
```

`init` writes `/home/shellmer/.config/shellm/env` with mode 600, asks for the token from the
previous step, generates an admin password, creates the first API key — shown once — and runs the
checks. Values you already set are never overwritten, so re-running it is safe.

Everything else is documented in [`.env.example`](../../.env.example). What matters on a server:

| Variable | Default | Why you would change it |
|---|---|---|
| `HOST` | `127.0.0.1` | Keep it. Expose SheLLM through a tunnel or proxy, not by binding publicly |
| `PORT` | `6100` | A port collision |
| `MAX_CONCURRENT` | `4` | Each CLI process costs 150–215 MB of RAM (measured in [`benchmarks.md`](./benchmarks.md)) |
| `MAX_STREAM_CONCURRENT` | `4` | Streaming holds a slot for the whole response and is capped separately |
| `SHELLM_GLOBAL_RPM` | `60` | Requests per minute across all keys |
| `SHELLM_ADMIN_PASSWORD` | generated | The dashboard login, at `/admin/login` |

`init` writes the load knobs into the config file rather than leaving them implicit, so the file
lists what you can tune. Changing one is an edit and a restart:

```bash
sudo -iu shellmer sed -i 's/^MAX_CONCURRENT=.*/MAX_CONCURRENT=6/' ~/.config/shellm/env
sudo systemctl restart shellm
curl -su "admin:$SHELLM_ADMIN_PASSWORD" localhost:6100/health/detailed | jq .queue
```

That last line reports the values the process is running, which is the only thing that proves the
restart took — the dashboard's System page reads the same figures.

Every limit is read from the environment, so nothing takes effect until the restart. The pair worth
moving together is `MAX_CONCURRENT` and `SHELLM_GLOBAL_RPM`: at ~3 s per request, 60 req/min
sustains about 3 concurrent, so raising the process cap alone only absorbs bursts. Overview says
which of the two is binding — it splits the time a request spent queueing from the time it spent
executing, and only queueing is fixed by raising a limit.

## 4. Start

```bash
sudo systemctl start shellm
sudo systemctl status shellm
sudo -iu shellmer shellm doctor --live   # spends one small request
```

`shellm doctor` without `--live` checks Node, the config file's permissions, the bind address, the
CLI and its login, and that an API key exists. Every failure prints the command that fixes it.

## 5. Reach it from outside

SheLLM listens on loopback only. Put it behind something that terminates TLS and authenticates:

- **Cloudflare Tunnel** — `cloudflared` on the same host, with `service: http://127.0.0.1:6100`.
  No inbound ports, TLS at the edge, and Cloudflare Access in front of `/admin/*` if you expose it.
- **A reverse proxy** you already run (Caddy, nginx) on the same machine.
- **A private network** (Tailscale, WireGuard) when only your own devices call it.

Whatever you choose, the API key is the only thing between a caller and your subscription quota.
Do not expose `/admin/*` to the internet without a second factor in front of it.

Over HTTPS the dashboard installs as a PWA: open it on a phone and use the browser's "Add to home
screen". It runs standalone, keeps the 12-hour session, and caches only its own shell — every
request for keys, logs or provider status still goes to the server.

**The install is a launcher, not an offline app.** Tailwind, Alpine and Chart.js come from a CDN,
so the page needs the network to assemble itself at all — and every number on every screen comes
from the gateway, so there would be nothing to show offline anyway
([ADR-0007](../adr/0007-installed-dashboard-is-a-launcher.md)).

## Operating it

```bash
sudo systemctl restart shellm           # restart
sudo journalctl -u shellm -f            # logs (JSON lines)
sudo -iu shellmer shellm status         # is it answering?
sudo -iu shellmer shellm doctor         # what is broken
sudo shellm update                      # move to the newest release
```

**Knowing there is something to upgrade to** is the dashboard's job: the System page shows the
version and commit the service is running, and compares them against the newest published
release. That comparison is made by your browser, not by the server — SheLLM needs no outbound
network to report what it is.

**Upgrade:**

```bash
sudo shellm update
```

That is the whole thing. It moves to the newest published release and does the rest in order:
**snapshots the database and the config file** before anything moves, installs dependencies only
if `package-lock.json` changed, runs migrations, re-installs any file the release changed that
lives outside the checkout, restarts, and then polls `/health`. **If the service does not answer,
it checks out the previous commit, restarts again, and exits non-zero** — so a bad release leaves
you where you were rather than with a service that will not start.

The snapshot comes first because migrations only go forward: the rollback restores the code, and
the snapshot is what lets you restore the data behind it. It is the same `shellm backup` described
below, writing to the same directory, and it runs whether the update came from the dashboard or
from this command — **if it cannot be written, the update stops there with nothing changed.**

Those outside files are the systemd units, the `tmpfiles.d` entry, the updater script and the
logrotate config — the same set `vps.sh` installs. Keeping them in step is what lets a release
that ships new wiring actually deliver it to a host that upgrades this way; it would otherwise
arrive as code with nothing behind it. Nothing is *enabled* by an update: a unit that was off
stays off.

It takes a few seconds, and prints each step.

To move to a specific release, or back to an earlier one:

```bash
SHELLM_REF=v1.0.0 sudo shellm update
```

### Updating from the dashboard (off by default)

The System page can move this host to a newer release. `vps.sh` installs the trigger that makes
that possible and leaves it disabled — turning it on arms a root unit the dashboard can reach, so
it is your decision, not the provisioning script's:

```bash
sudo systemctl enable --now shellm-update.path
sudo systemctl is-active shellm-update.path    # what the dashboard reports
```

What it installs, and what each piece is for:

| | |
|---|---|
| `shellm-update.path` | Watches `/run/shellm/update-request.json`, which the dashboard writes |
| `shellm-update.service` | Runs the updater once, as root |
| `/usr/local/lib/shellm/shellm-update-runner.sh` | Validates the request, resolves the tag to a commit id against the repository, snapshots the database, then calls `shellm update` |
| `/etc/tmpfiles.d/shellm.conf` | Creates `/run/shellm`, owned by `shellmer` |

The page offers only releases **newer** than the one running, with a link to each one's notes. A
major version jump asks for the version to be typed before the button works, because that is where
a migration can be one-way. Rolling back is deliberately not offered here — it is
`SHELLM_REF=vX.Y.Z sudo shellm update`, where someone is already looking at the host.

When the trigger is not armed the page says which of the two reasons applies, because they have
different fixes: the units are not installed at all (re-run `vps.sh`) or they are installed and
switched off (`systemctl enable --now`). `systemctl is-active` cannot tell those apart — it
answers `inactive` for both — so the dashboard asks about the unit file as well.

The runner refuses anything that is not a published release tag, and it checks out a **commit id**
it resolved itself rather than the name it was given, so a rewritten local tag cannot redirect it.
The snapshot is `shellm update`'s, not the runner's, so the button and the SSH command take the
same one. The outcome lands in `/home/shellmer/.shellm/update-status.json` — durable on
purpose, because you read it *after* the restart, which is when a rollback is what you want to
know about.

**A request is consumed even if the update then fails, and nothing retries it.** The runner claims
the request before it does any work, because the trigger re-fires while the file is on disk and a
request cleared at the end would loop forever on any crash. That means a failure — a database
snapshot that would not write, a tag that does not resolve — stops there and says so in
`update-status.json` rather than arming itself again as root. Pressing the button a second time is
a person's decision.

The status file is also how you tell a killed update from one that never started: it is written as
`"state": "running"` with no `finished_at` before any work begins, and rewritten with the outcome
at the end, including when the runner is terminated. A `running` record older than the unit's
`TimeoutStartSec` means it was killed outright — `journalctl -u shellm-update` has the rest, and
`/run/shellm/update-request.json.claimed` still holds what was asked for.

Disable it again with `sudo systemctl disable --now shellm-update.path`. `sudo shellm update` over
SSH works either way, and nothing else in SheLLM depends on the trigger.

**Re-run `scripts/setup/vps.sh` instead when** you are installing for the first time, changing
`CLAUDE_VERSION` or `CODEX_VERSION`, or repairing an install — it is idempotent and rebuilds
everything it manages, including the unit. It verifies nothing, and the only time it restarts the
service is the first time it creates `/run/shellm` (see the troubleshooting table for why it has
to), so follow it with `sudo systemctl restart shellm`.

The checkout is left detached at a tag either way, so `git pull` inside it does nothing useful:
the ref is chosen by the tooling, not by a tracking branch. A repository with no tags at all
falls back to the default branch.

**The service runs confined.** The unit mounts the filesystem read-only, grants
`/home/shellmer` back, and then makes the checkout itself read-only — so neither the service nor
the CLIs it spawns can modify the code being executed. Two consequences worth knowing before you
debug something strange:

- **Editing files under `/home/shellmer/shellm` while the service runs has no effect on it**, and
  a process inside the service that tries will get a read-only filesystem error. Upgrades work
  because they run outside the unit.
- **Anything that stores state inside the checkout will fail.** The CLIs do not — they write to
  the home directory — but a new provider that did would need its path added to the unit.

### Backing up

```bash
sudo -u shellmer -H shellm backup
```

That writes one snapshot into `/var/lib/shellm/backups`, keeping the newest 7 and deleting older
ones it wrote itself:

```
/var/lib/shellm/backups/20260920T031500Z/
  shellm.db     the database — API keys, request logs, audit trail
  config.env    the config file — admin password and the CLI OAuth tokens
```

**Both files are mode 0600 and the directory is 0700, and they should stay that way wherever you
copy them.** Between them they are enough to impersonate this install.

A snapshot is written to a temporary name, verified, and only then renamed into place, so a run
that fails leaves nothing half-written and never damages the snapshot you already had. **It exits
non-zero when the snapshot did not happen** — a scheduled job can trust the exit status.

**Taking one nightly**, if you have no backup tooling of your own:

```bash
sudo systemctl enable --now shellm-backup.timer
systemctl list-timers shellm-backup.timer
```

`scripts/setup/vps.sh` installs that timer and leaves it off, the same way it treats the update
trigger. If you already schedule backups, leave it off and call `shellm backup` from what you run.

**Getting the snapshots off this host is yours.** SheLLM makes a consistent copy in a directory it
owns; copying that directory somewhere else — rsync, restic, borg, an object store, whatever you
already use — and deciding how long to keep it are yours. Point your tool at
`/var/lib/shellm/backups` and nothing here needs to know which one you picked.

`--dir` writes somewhere else. Note that `shellm-backup.service` can only write
`/home/shellmer/.shellm` and `/var/lib/shellm`, so a different directory in the timer's path needs
a drop-in granting it, or the unit fails with a read-only filesystem error.

**Do not run it as root.** It refuses, and the refusal is the point: opening the database creates
its `-wal` and `-shm` files, and root-owned ones in `/home/shellmer/.shellm` leave the service
unable to write its own database.

**Why not just copy the file.** The database runs in WAL mode, so **`cp` of the `.db` is not a
backup** — the copy comes out torn or missing recent writes. On a live install the `.db` file was
86 KB with an mtime six months old while the `-wal` beside it held 3.3 MB: a `cp` of the `.db`
alone hands you the state of six months ago, at full size, with nothing about it looking wrong.
`shellm backup` uses SQLite's online backup, which is consistent while the service is running and
under load.

### Restoring

The snapshot is two ordinary files. Nothing about restoring assumes the tool that carried them
here, or that they came from this host.

```bash
snapshot=/var/lib/shellm/backups/20260920T031500Z   # the one you are restoring

# 1. Snapshot what is there now, so the restore is itself reversible. If this fails because the
#    current database is unreadable, that is usually why you are here — carry on.
sudo -u shellmer -H shellm backup

# 2. Stop the service and remove the current database WITH its -wal and -shm. A restored .db
#    beside the old WAL is not the database you restored.
sudo systemctl stop shellm
sudo -u shellmer rm -f /home/shellmer/.shellm/shellm.db \
                       /home/shellmer/.shellm/shellm.db-wal \
                       /home/shellmer/.shellm/shellm.db-shm

# 3. Put the snapshot in place, owned by the service user and readable by nobody else.
sudo install -o shellmer -g shellmer -m 600 "$snapshot/shellm.db"  /home/shellmer/.shellm/shellm.db
sudo install -o shellmer -g shellmer -m 600 "$snapshot/config.env" /home/shellmer/.config/shellm/env

# 4. Start and check.
sudo systemctl start shellm
sudo -iu shellmer shellm doctor
```

Restore the config file only if you are also restoring its secrets — a snapshot from another host,
or one taken before you rotated the admin password, will put the old values back.

**Rehearse it.** A backup nobody has restored is not a backup, and this costs nothing: point
`HOME` at a throwaway directory and start a second instance on another port, with the live one
still running.

```bash
rehearsal=$(sudo -u shellmer mktemp -d)
sudo -u shellmer mkdir -p "$rehearsal/.shellm" "$rehearsal/.config/shellm"
sudo -u shellmer cp "$snapshot/shellm.db"  "$rehearsal/.shellm/shellm.db"
sudo -u shellmer cp "$snapshot/config.env" "$rehearsal/.config/shellm/env"
sudo -u shellmer env HOME="$rehearsal" shellm start -p 6199    # Ctrl-C when done

curl -s localhost:6199/health                                   # from another shell
curl -s localhost:6199/v1/models -H "Authorization: Bearer <a key from that snapshot>"
```

If the second command answers with your models, that snapshot is a working install: the database
came back intact and the keys inside it still authenticate. Delete `$rehearsal` afterwards.

**Uninstall:**

```bash
ssh root@your-server 'bash -s' < scripts/setup/vps-uninstall.sh            # keeps the data
ssh root@your-server 'bash -s -- --purge' < scripts/setup/vps-uninstall.sh # removes the user too
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `doctor` says the config is readable by other users | `chmod 600 /home/shellmer/.config/shellm/env` |
| `Claude login: not logged in` | The token expired or was never set. Repeat step 2 and put it in `CLAUDE_CODE_OAUTH_TOKEN` |
| `503 provider_unavailable` | The provider is disabled, unauthenticated, or its circuit is open after repeated failures. `shellm doctor --live` says which |
| `504 timeout` | The CLI outlived `TIMEOUT_MS` (default 120 s). Cold starts are 2–4 s, so a timeout usually means the provider is degraded |
| `429 rate_limited` | Your own limit (`SHELLM_GLOBAL_RPM`, or the key's `rpm`), not the provider's |
| The service starts and exits immediately | `journalctl -u shellm -n 50`. A missing config file is the common cause: run `shellm init` as `shellmer` |
| `Failed to set up mount namespacing` and the service will not start | A path the unit grants does not exist. The unit tolerates `/run/shellm` being absent; a hand-edited `ReadWritePaths` naming something else does not |
| `EROFS` or "read-only file system" in the logs | Something tried to write inside the checkout, which the unit mounts read-only on purpose. State belongs under `/home/shellmer`, not next to the code |
| The dashboard's update button does nothing and logs a read-only error for `/run/shellm` | `ProtectSystem=strict` mounts all of `/run` read-only inside the service's namespace, and the exception for `/run/shellm` is skipped while that directory does not exist. The namespace is built at start, so a service that was already running when the directory first appeared cannot write there. `sudo systemctl restart shellm` |
| The update button reports that the updater is not enabled | `sudo systemctl enable --now shellm-update.path`. `sudo shellm update` works regardless |
| `shellm-update.service` keeps starting over and over | A request file that was never deleted. `PathExists=` is level-triggered on purpose, so it re-fires while the file is there: `sudo rm /run/shellm/update-request.json`, then `journalctl -u shellm-update -n 100` for why the runner did not remove it itself |
| `shellm backup` refuses to run as root | Run it as the service user: `sudo -u shellmer -H shellm backup`. As root it would leave root-owned `-wal` and `-shm` files that the service cannot write |
| `shellm backup` cannot create `/var/lib/shellm/backups` | `/var/lib` is root's. Re-run `vps.sh`, or `sudo install -d -m 0750 -o shellmer -g shellmer /var/lib/shellm/backups` once |
| An update stopped at "Snapshotting the database" | Nothing was changed — the update refuses to go on without one. Fix the snapshot (the two rows above) and run it again |
| `shellm-backup.service` fails with a read-only filesystem error | The unit grants `/home/shellmer/.shellm` and `/var/lib/shellm` and nothing else. A `--dir` elsewhere needs `systemctl edit shellm-backup.service` with a `ReadWritePaths=` for it |
| A `.partial-…` directory in the backup directory | A snapshot that was killed outright. It is not a snapshot, nothing will ever read it, and it is safe to delete |
| Works locally but not through the tunnel | The tunnel points at the wrong port, or `HOST` is not loopback |

When the subscription's own quota runs out, the CLI says so and the error surfaces as
`502 cli_failed` carrying the CLI's message.
