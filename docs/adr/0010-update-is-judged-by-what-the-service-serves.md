# ADR-0010 — An update is judged by what the running service serves, and every failure rolls back

- **Status:** accepted
- **Date:** 2026-09-27
- **Amends:** ADR-0003 (its rollback ran only when `/health` did not answer) and keeps ADR-0004
  (restoring a snapshot stays a documented human step).

## Context

Three incidents and one reading of the code showed that `shellm update` judged the wrong thing:

- **The gate tested liveness.** `/health` is a constant `{"status":"ok"}`, and the gate
  substring-matched it. A release that boots with every provider unauthenticated passed and stayed.
- **Only the health check rolled back.** A failure in `npm ci` — observed 1.5.0 → 1.6.0, when a
  native build found no `make` — left the checkout on the new release and `node_modules` empty,
  while the runner reported *"it rolls back on its own"*.
- **The run was reported as the host.** A retry found the checkout already at the target and said
  `running v1.6.0` while the process still served v1.5.0 from a deleted shared object; later the
  dashboard said the update had failed while the host was fine.
- **A broken install could not update itself.** The snapshot needs `better-sqlite3`, which the
  failed `npm ci` had removed, and the failure named no way out.

## Decision

1. **Healthy means the process serves the requested commit with at least one provider up.** The
   gate asks `shellm status --json`, run as the service user, which reads `/admin/health` with the
   admin credentials from the config file. `build.commit` must match the target and `status` must
   not be `down`. It parses JSON; nothing is substring-matched. Without admin credentials only the
   port can be checked, and the result says `not verified`.
2. **Every failure after the checkout rolls back**, not only a failed health check: the previous
   commit is checked out, its dependencies reinstalled if `npm ci` ran, changed system files put
   back, the service restarted, and the previous release confirmed serving by the same gate.
3. **The outcome is one `RESULT:` line**, written by the CLI from what happened and copied by the
   root runner into the status the dashboard reads. The runner no longer claims a rollback in
   advance or checks the checkout instead of the process.
4. **A checkout already at the target is not "nothing to do"** unless the service serves it; if it
   does not, the service is restarted and judged.
5. **The schema is not reverted automatically.** ADR-0004 rejected a restore command, and that
   still holds. When the failed release carried a migration, `RESULT:` names the snapshot to
   restore and points at the documented procedure.
6. **A snapshot that cannot run because the install is incomplete names `vps.sh`** as the
   recovery. The update still refuses to proceed without a snapshot.

## Consequences

- The updater now depends on the admin password being set to verify anything beyond the port.
  Every host that has the dashboard has one.
- A rollback that itself fails, or lands on a previous release that is not healthy either, ends
  with the command that recovers the host (`scripts/setup/vps.sh`) instead of a claim.
- The sequence is testable without a host: `run({ host })` takes npm, systemd, the snapshot and
  the service as parameters, and `test/cli/update-run.test.js` drives it against a real repository.
- Still unexercised on a real host: a rollback through a failing `npm ci` and a migrating release.
  Both are covered by tests only.
