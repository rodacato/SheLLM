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
Code pinned to `CLAUDE_VERSION` (see [`VERSIONS.md`](../../VERSIONS.md)), clones the repository to
`/home/shellmer/shellm`, links the `shellm` command, and installs the systemd unit and the
logrotate config. It does **not** start the service and does **not** configure a tunnel.

Override defaults with environment variables:

```bash
ssh root@your-server 'CLAUDE_VERSION=2.1.273 bash -s' < scripts/setup/vps.sh
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
| `MAX_CONCURRENT` | `2` | Each CLI process costs 100–200 MB of RAM |
| `SHELLM_ADMIN_PASSWORD` | generated | The dashboard login |
| `SHELLM_GLOBAL_RPM` | `30` | Requests per minute across all keys |

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

## Operating it

```bash
sudo systemctl restart shellm           # restart
sudo journalctl -u shellm -f            # logs (JSON lines)
sudo -iu shellmer shellm status         # is it answering?
sudo -iu shellmer shellm doctor         # what is broken
```

**Upgrade:**

```bash
sudo -iu shellmer bash -c "cd ~/shellm && git pull && npm ci --omit=dev"
sudo cp /home/shellmer/shellm/shellm.service /etc/systemd/system/shellm.service
sudo systemctl daemon-reload && sudo systemctl restart shellm
```

Re-copy the unit only when it changed; `git log -- shellm.service` tells you.

**Back up** `/home/shellmer/.shellm/shellm.db` (keys, request logs, audit trail) and
`/home/shellmer/.config/shellm/env` (secrets). Both are plain files; `cp` is a valid backup.

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
| Works locally but not through the tunnel | The tunnel points at the wrong port, or `HOST` is not loopback |

When the subscription's own quota runs out, the CLI says so and the error surfaces as
`502 cli_failed` carrying the CLI's message.
