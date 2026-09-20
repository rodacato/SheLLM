# ADR-0004 — A consistent snapshot is a command this repository owns; the contract with the operator is a directory

- **Status:** accepted
- **Date:** 2026-09-20
- **Amends:** ADR-0003's updater sequence — the pre-update snapshot moves out of
  `shellm-update-runner.sh` and into `shellm update`. Corrects ADR-0001's "a single file, backup
  is `cp`", which [ADR-0003](./0003-release-and-update-cycle.md) had already contradicted in
  prose without amending the line.

## Context

"Take a consistent snapshot of SheLLM" was implemented twice, in two repositories, and neither
copy lived in this CLI:

- `scripts/setup/shellm-update-runner.sh` shelled out to `sqlite3 .backup` before every update.
- An operator backup job, outside this repository, ran its own nightly `sqlite3 .backup`, copied
  the config file, and carried both off the host.

Four consequences, in the order they hurt:

- **Two copies diverge.** It is the failure ADR-0003 refused for the update sequence itself,
  which is why the runner calls `shellm update` instead of reimplementing it. The snapshot was
  the one part of that sequence the runner did perform.
- **The outside job hardcoded paths that belong to this project** — the database and the config
  file. A release that moved either would leave that job reporting successful backups of
  nothing: a silent failure in the one system whose whole job is not to fail silently.
- **This repository is public and had no answer to "how do I back this up".** A `cp` of the
  `.db` is not one: on a live install the `.db` was 86 KB with an mtime six months old while the
  `-wal` beside it held 3.3 MB. The `cp` returns the state of six months ago, at full size, with
  nothing about it looking wrong. The only worked answer lived in private infrastructure.
- **`shellm update` over SSH took no snapshot at all.** Only the button path did, because the
  snapshot lived in the runner. Migrations only go forward, so that asymmetry decides whether a
  rollback is a rollback.

There was also evidence that produced itself. The manual procedure in
`docs/guides/deployment.md` had to be fixed hours before this decision because it destroyed the
previous backup: a tilde expanded in the wrong shell, and an `mv` not chained behind a command
that fails leaves an empty file. Three bugs, all of them there because the backup was a shell
procedure in a document rather than a command. A command deletes all three.

## Decision

### 1. `shellm backup [--dir DIR]`, registered like any other command

`src/cli/backup.js`, in the `commands` map of `src/cli.js` beside `update`, listed in
`shellm help`. It writes the database and the config file into one directory, default
`/var/lib/shellm/backups`.

A snapshot is a directory named for the UTC instant it was taken:

```
/var/lib/shellm/backups/20260920T031500Z/
  shellm.db      0600   the online backup, verified
  config.env     0600   the admin password and the CLI OAuth tokens
```

Both files are 0600 and the directory is 0700, said out loud here and in the guide, because the
config file carries credentials and the database carries API key hashes and the request log.
Following an instruction should not be how someone ends up with a world-readable copy of either.

### 2. `better-sqlite3`'s backup API, not the `sqlite3` binary

It is already a dependency (`^12.11.1`), it is online-safe under WAL, and using it removes a
system requirement: provisioning installed the `sqlite3` package for this and nothing else.

### 3. The split: SheLLM knows consistency, the operator knows retention

**SheLLM produces a consistent snapshot in a directory it owns and documents. The operator
carries that directory away with whatever they already run.** No backup tool is named anywhere
in this repository — not rsync, not restic, not borg, not an object store. Off-host copies,
encryption and long-term retention are the operator's, and a repository that guessed at them
would be wrong for most of the people reading it.

What stays here is the part that is genuinely ours: a copy that is not torn.

### 4. It refuses to run as root

Opening a WAL database creates its `-wal` and `-shm` files when they are absent. As root they
land root-owned in the service user's state directory, and the service can no longer write its
own database. That is the failure this change exists to remove, so it must not be moved onto a
path that runs nightly.

Of the three available answers — refuse, drop privileges, or make the unit carry the service
user — this takes the first **and** the third: the command refuses, and
`shellm-backup.service` carries `User=shellmer`. Dropping privileges was rejected because a
command that re-executes itself as another user is harder to reason about than one that stops.

The nuance worth recording: `src/cli/paths.js` derives everything from `os.homedir()`, so a bare
`sudo shellm backup` is already safe **by accident** — it looks for `/root/.shellm` and finds
nothing. The dangerous shape is root with `HOME` pointing at the service user's home, which is
exactly what a badly written `shellm-backup.service` would do. The refusal is aimed at that one.

### 5. A snapshot that did not happen exits non-zero

The caller learns from the exit status, not from stdout. A command that prints its error and
exits 0 turns a scheduled backup into a job that reports success while backing up nothing —
which is the whole failure this work removes.

Everything is written into a `.partial-<stamp>` directory and renamed into place only after it
verifies, so a failure leaves nothing half-written and never touches an earlier snapshot on its
way out. Pruning runs after a successful snapshot, never before.

**Verification is three checks, not one**, because of a false positive that has already bitten:
a zero-byte file is a valid empty SQLite database and `PRAGMA integrity_check` answers `ok` for
it. So: the file is not empty, `integrity_check` says `ok`, and the schema is not empty either.

### 6. Local retention belongs to whoever writes the directory, which is this repository

The command keeps the newest `--keep` snapshots (default 7) and deletes the rest. It matches its
own name pattern exactly — `YYYYMMDDThhmmssZ` — so it can never delete a file it did not write.
That removes the class of bug where two pruning globs overlap, by construction rather than by
care: there is one writer and one pattern. A `.partial-` directory left behind by a run that was
killed outright does not match it and is never counted as a snapshot.

### 7. `shellm update` takes the snapshot; the runner stops taking one

This is the asymmetry from the context, and it is closed rather than documented. The snapshot is
part of the update sequence — it is what makes the rollback at the end of that sequence a
rollback — and ADR-0003's line is that the sequence lives in `src/cli/update.js` and the runner
may add checks around it but may not perform it. The snapshot was the exception; it no longer is.

It is taken after the target ref resolves and before anything moves: by the release that is
still running, before the checkout, before `npm ci`, before the migrations that do not roll back.
A snapshot that will not write stops the update there, with nothing changed.

The runner therefore does not call `shellm backup` either. Doing both would mean two snapshots
per button press for one update.

### 8. Scheduling ships installed and switched off

`shellm-backup.service` and `shellm-backup.timer` ship beside the update units, are installed by
`scripts/setup/vps.sh`, and are **not enabled** — the same split as `shellm-update.path` and for
the same reason: installing is the script's job, turning something on is the operator's.

Whoever already schedules backups leaves the timer off and calls `shellm backup` from what they
run. Whoever has no tooling runs `systemctl enable --now shellm-backup.timer` and is done.

## What was rejected

- **Naming a backup tool.** Any choice here is wrong for most self-hosters, and the directory is
  a contract every tool already understands.
- **A `shellm restore` command.** Restoring is rare, is done with the service stopped, and is two
  file copies. It is documented in `docs/guides/deployment.md`; automating it is work nobody
  asked for, and a restore command that is wrong is worse than a paragraph that is right.
- **Leaving the snapshot in the runner and calling `shellm backup` from it.** It keeps the SSH
  path without a snapshot, which is half of what this decision exists to fix.
- **Dropping privileges instead of refusing to run as root.** See §4.
- **Backing up anything else under `~/.shellm`.** Logs rotate and the pid file is noise. The
  database and the config file are the state that cannot be rebuilt.

## Consequences

- An operator backup job stops knowing anything about this project's internals: it runs
  `shellm backup` (or enables the timer) and copies one directory. A release that moves the
  database no longer silently breaks it.
- Provisioning no longer needs the `sqlite3` package for backups.
- **The snapshot directory holds credentials.** 0700 on the directory, 0600 on both files, and
  wherever the operator copies it to inherits that responsibility.
- A `.partial-…` directory in the backup directory means a snapshot was killed outright. It is
  not a snapshot and is safe to delete.
- Two snapshots taken in the same second collide on the name and the second one fails rather
  than overwriting the first. It is the right direction to fail in.
- `shellm-backup.service` grants itself `/home/shellmer/.shellm` and `/var/lib/shellm` and
  nothing else, so a `--dir` outside both needs a drop-in that grants it. The unit fails loudly
  with a read-only filesystem error rather than skipping the snapshot.
- The restore path is exercised by the test suite rather than asserted: a snapshot is restored
  into a disposable state directory and the real server is booted against it, answering with a
  key that only exists inside that snapshot. A backup that has never been restored is not one.
