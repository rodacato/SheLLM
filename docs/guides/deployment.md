# VPS Deployment Guide

Step-by-step guide for deploying SheLLM on a VPS with cloudflared. After following this guide you'll have SheLLM running behind your own domain with TLS, authentication, and all providers ready to use.

---

## Prerequisites

| Requirement | Why |
|---|---|
| A VPS with Ubuntu 22.04+ (or Debian 12+) | SheLLM runs as a systemd service |
| Root SSH access | Initial setup creates a dedicated user |
| A Cloudflare account with a domain | cloudflared tunnel provides TLS + zero-trust access |
| CLI subscriptions (at least one) | Claude Max, Gemini AI Plus, or OpenAI Enterprise |

> **How much VPS do you need?** SheLLM is lightweight — 1 vCPU / 1 GB RAM handles most workloads. The bottleneck is CLI subprocess concurrency (`MAX_CONCURRENT`), not SheLLM itself. A 2 vCPU / 2 GB VPS is comfortable for `MAX_CONCURRENT=4`.

---

## Step 1 — Run the setup script

SSH into your VPS as root and run:

```bash
# Download and run in one step
curl -fsSL https://raw.githubusercontent.com/rodacato/SheLLM/master/scripts/setup-vps.sh | bash
```

Or clone first if you prefer to inspect the script:

```bash
git clone https://github.com/rodacato/SheLLM.git /home/shellmer/shellm
bash /home/shellmer/shellm/scripts/setup-vps.sh
```

**What the script does:**

1. Creates a `shellmer` system user (SheLLM never runs as root)
2. Installs Node.js 22 via NodeSource
3. Installs LLM CLIs globally (Claude Code, Gemini CLI, Codex CLI)
4. Clones the repo and runs `npm ci --omit=dev`
5. Links the `shellm` CLI
6. Copies `.env.example` to `.env`
7. Installs the systemd service (`shellm.service`)
8. Installs cloudflared

After the script finishes you'll see a summary of next steps. Don't start the service yet — we need to configure secrets and authenticate the CLIs first.

---

## Step 2 — Configure environment variables

Edit the `.env` file:

```bash
nano /home/shellmer/shellm/.env
```

### Required settings

```bash
# Admin dashboard password (minimum 12 characters)
SHELLM_ADMIN_PASSWORD=your-strong-password-here

# Admin username (optional but recommended)
SHELLM_ADMIN_USER=admin
```

> **Security note:** SheLLM refuses to start in production if the admin password is shorter than 12 characters or matches common weak passwords.

### Recommended settings

```bash
# Global rate limit — adjust based on your VPS capacity
SHELLM_GLOBAL_RPM=30

# Webhook for alerts (Slack, Discord, or Uptime Kuma)
# SheLLM posts provider health transitions and auth failure spikes here
SHELLM_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz

# Cerebras API key (only if you want the Cerebras provider)
CEREBRAS_API_KEY=csk-xxx
```

### Optional tuning

```bash
# Increase concurrency if your VPS has 2+ vCPUs
MAX_CONCURRENT=4
MAX_QUEUE_DEPTH=20

# CLI process timeout (default: 2 minutes)
TIMEOUT_MS=120000

# Log level: debug | info | warn | error
LOG_LEVEL=info
```

See [.env.example](../../.env.example) for the full list with descriptions.

---

## Step 3 — Authenticate CLI providers

Each CLI tool needs a one-time browser-based authentication. Switch to the `shellmer` user and authenticate:

```bash
sudo -iu shellmer
```

### Claude Code

```bash
claude auth login
```

This opens a browser URL — copy-paste it if you're on a headless VPS. Follow the Anthropic login flow. Verify with:

```bash
claude --version
```

### Gemini CLI

```bash
gemini auth login
```

Follow the Google OAuth flow. Verify with:

```bash
gemini --version
```

### Codex CLI

```bash
codex auth login
```

Follow the OpenAI login flow. Verify with:

```bash
codex --version
```

> **You only need to authenticate the providers you plan to use.** SheLLM gracefully marks unavailable providers as `unhealthy` — they won't break the service.

When done, exit the shellmer session:

```bash
exit
```

---

## Step 4 — Run database migrations and seed data

SheLLM uses SQLite. Migrations run automatically on first start, but you can run them explicitly:

```bash
sudo -iu shellmer bash -c "cd ~/shellm && npm run migrate"
```

### Seed demo data (optional but recommended for first deploy)

The seed script creates demo API clients and sample request logs so the dashboard has data to display on first visit:

```bash
sudo -iu shellmer bash -c "cd ~/shellm && npm run seed"
```

This creates:

| What | Details |
|---|---|
| `demo-app` client | 60 RPM, all providers |
| `test-runner` client | 10 RPM, claude + cerebras only |
| `expired-client` | Already expired (shows expiration handling) |
| 30 request log entries | Spread across providers, mixed success/error |

> **Important:** The seed script prints the raw API keys to the terminal. Copy the `demo-app` key — you'll use it in Step 7 to verify the setup.

If you prefer to start clean without demo data, skip this step and create your first real API key from the admin dashboard in Step 7.

---

## Step 5 — Start SheLLM

```bash
sudo systemctl start shellm
```

Verify it's running:

```bash
# Check systemd status
sudo systemctl status shellm

# Check the health endpoint
curl http://127.0.0.1:6100/health
```

You should see a JSON response with provider statuses:

```json
{
  "status": "healthy",
  "providers": {
    "claude": { "status": "healthy" },
    "gemini": { "status": "healthy" },
    "cerebras": { "status": "healthy" }
  },
  "queue": { "active": 0, "waiting": 0, "max": 2 }
}
```

If a provider shows `unhealthy`, check its auth:

```bash
# View logs for errors
journalctl -u shellm -n 50 --no-pager

# Re-authenticate if needed
sudo -iu shellmer
claude auth login   # or gemini/codex
exit
sudo systemctl restart shellm
```

### Enable on boot

The setup script already ran `systemctl enable shellm`, so the service starts automatically after a reboot.

---

## Step 6 — Set up cloudflared tunnel

cloudflared creates a secure tunnel from Cloudflare's edge to your VPS. No ports need to be opened in your firewall — all traffic flows outbound through the tunnel.

### 6.1 — Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser to select which Cloudflare zone (domain) to authorize.

### 6.2 — Create the tunnel

```bash
cloudflared tunnel create shellm
```

Note the **Tunnel ID** in the output — you'll need it for the config.

### 6.3 — Route DNS

```bash
cloudflared tunnel route dns shellm shellm.notdefined.dev
```

This creates a CNAME record pointing `shellm.notdefined.dev` to your tunnel.

### 6.4 — Create the config file

```bash
mkdir -p /etc/cloudflared
nano /etc/cloudflared/config.yml
```

```yaml
tunnel: shellm
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: shellm.notdefined.dev
    service: http://127.0.0.1:6100
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Replace `<TUNNEL_ID>` with the actual tunnel ID from step 6.2.

> **Port note:** SheLLM defaults to port **6100**. If you changed `PORT` in `.env`, update the service URL here to match.

### 6.5 — Install cloudflared as a service

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

### 6.6 — Verify the tunnel

```bash
# Check tunnel status
cloudflared tunnel info shellm

# Test from the internet
curl https://shellm.notdefined.dev/health
```

You should see the same health JSON, now served over HTTPS through Cloudflare.

---

## Step 7 — First login and verification

### Access the admin dashboard

Open your browser and navigate to:

```
https://shellm.notdefined.dev/admin/dashboard/
```

Log in with the credentials from your `.env`:

- **Username:** the value of `SHELLM_ADMIN_USER` (default: any username works)
- **Password:** the value of `SHELLM_ADMIN_PASSWORD`

### Create your first API key

If you didn't run the seed script, create a key from the **Keys** page in the dashboard:

1. Click **Create Key**
2. Set a name (e.g., `my-app`)
3. Set RPM (requests per minute) — start with `10`
4. Copy the generated key — it's shown only once

### Test from the Playground

The dashboard includes an interactive **Playground** page:

1. Go to the **Playground** tab in the sidebar
2. Select a provider (e.g., `claude`)
3. Type a prompt: `Say hello in one sentence`
4. Click **Send**

You should see the response stream in real time. This confirms the full chain works: browser → Cloudflare → tunnel → SheLLM → CLI provider → response.

### Test via curl

From any machine with internet access:

```bash
curl https://shellm.notdefined.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{
    "model": "claude",
    "messages": [{"role": "user", "content": "Say hello in one sentence"}]
  }'
```

---

## Step 8 — Production hardening

### Add Cloudflare Access (optional, recommended)

Cloudflare Access adds a login wall in front of SheLLM — even before traffic reaches your VPS. This is especially useful for the admin dashboard.

1. Go to **Cloudflare Zero Trust → Access → Applications**
2. Create a **Self-hosted** application
3. Set the domain to `shellm.notdefined.dev`
4. Add a path rule: `/admin/*` → require email OTP or SSO
5. Leave `/v1/*` and `/health` open (API clients use Bearer tokens)

### Firewall

SheLLM binds to `127.0.0.1` — it doesn't listen on public interfaces. But as a best practice, confirm no ports are exposed:

```bash
# Should show nothing listening on 0.0.0.0:6000
ss -tlnp | grep 6100
```

Since all traffic goes through cloudflared, you can block all inbound ports except SSH:

```bash
ufw default deny incoming
ufw allow ssh
ufw enable
```

### Monitoring

SheLLM sends webhook alerts for:

- Provider health transitions (healthy → unhealthy and back)
- Auth failure spikes (configurable threshold)
- Prompt injection blocks

Configure `SHELLM_ALERT_WEBHOOK_URL` in `.env` to receive these in Slack, Discord, or any webhook-compatible service.

Check service health at any time:

```bash
# Quick status
curl https://shellm.notdefined.dev/health

# Detailed diagnostics (admin auth required)
curl -u admin:your-password https://shellm.notdefined.dev/health/detailed

# Systemd logs
journalctl -u shellm -f

# SheLLM logs
sudo -iu shellmer shellm logs -f
```

### Log rotation

The setup script installs a logrotate config at `/etc/logrotate.d/shellm`. Logs are rotated weekly, compressed, and kept for 4 weeks.

---

## Updating SheLLM

```bash
# Pull latest code
sudo -iu shellmer bash -c "cd ~/shellm && git pull && npm ci --omit=dev"

# Restart the service (migrations run automatically on start)
sudo systemctl restart shellm

# Verify
curl https://shellm.notdefined.dev/health
```

---

## Troubleshooting

### Provider shows "unhealthy"

```bash
# Check which provider is failing
curl http://127.0.0.1:6100/health | jq .providers

# Test the CLI directly
sudo -iu shellmer
claude --version          # should print version
claude "test" --print     # should respond

# If auth expired, re-authenticate
claude auth login
exit
sudo systemctl restart shellm
```

### "Connection refused" on the tunnel

```bash
# Is SheLLM running?
systemctl status shellm

# Is cloudflared running?
systemctl status cloudflared

# Does the port match?
curl http://127.0.0.1:6100/health
```

### Admin dashboard returns 401

- Verify `SHELLM_ADMIN_PASSWORD` is set in `.env`
- Check for IP lockout (5 failed attempts → 5 min lockout)
- View auth failures: `journalctl -u shellm | grep "admin auth"`

### High latency on first request

CLI processes have cold-start overhead (2-5s for Claude, 1-3s for Gemini). This is normal on the first request after idle. Subsequent requests within the health poll interval are faster. The background health poller keeps providers warm.

### Out of memory

Reduce `MAX_CONCURRENT` in `.env`. Each CLI subprocess can consume 100-200 MB. With the default limit of 768 MB (Docker) or system RAM (systemd), keep concurrency low:

| VPS RAM | Recommended MAX_CONCURRENT |
|---|---|
| 1 GB | 2 |
| 2 GB | 4 |
| 4 GB | 6-8 |

---

## Architecture recap

```
Internet
    │
    ▼
┌─────────────────────────┐
│   Cloudflare Edge       │  TLS termination, DDoS protection
│   shellm.notdefined.dev │  (optional: Cloudflare Access)
└───────────┬─────────────┘
            │ encrypted tunnel
            ▼
┌─────────────────────────┐
│   cloudflared           │  Runs as systemd service
│   (outbound tunnel)     │  No inbound ports needed
└───────────┬─────────────┘
            │ http://127.0.0.1:6100
            ▼
┌─────────────────────────┐
│   SheLLM                │  Node.js + Express
│   (systemd service)     │  Auth, rate limiting, queue
│                         │  Prompt guard, audit logging
│   ┌──────┬──────┬─────┐ │
│   │Claude│Gemini│Codex│ │  CLI subprocesses
│   └──────┴──────┴─────┘ │
│   ┌────────┐            │
│   │Cerebras│            │  HTTP API
│   └────────┘            │
│   ┌──────┐              │
│   │SQLite│              │  Keys, logs, settings
│   └──────┘              │
└─────────────────────────┘
```

---

## Quick reference

| Task | Command |
|---|---|
| Start service | `sudo systemctl start shellm` |
| Stop service | `sudo systemctl stop shellm` |
| Restart service | `sudo systemctl restart shellm` |
| View logs (live) | `journalctl -u shellm -f` |
| Check health | `curl http://127.0.0.1:6100/health` |
| Re-auth a CLI | `sudo -iu shellmer && claude auth login && exit` |
| Update SheLLM | `sudo -iu shellmer bash -c "cd ~/shellm && git pull && npm ci --omit=dev" && sudo systemctl restart shellm` |
| Tunnel status | `cloudflared tunnel info shellm` |
| View admin logs | `journalctl -u shellm \| grep admin` |

---

## FAQ

### Which user do I use for what?

| User | Purpose |
|---|---|
| **root** or **deploy** (with sudo) | systemctl, editing .env, cloudflared, firewall |
| **shellmer** | CLI authentication (claude/gemini/codex), manual server testing |

`shellmer` is intentionally unprivileged — it cannot run `sudo`. Service management always happens from a user with sudo access.

### Git clone fails with "Permission denied (publickey)"

The setup script uses HTTPS, not SSH. If you see this error you may be running an older version of the script, or cloning manually with `git@github.com:...`. Use HTTPS instead:

```bash
git clone https://github.com/rodacato/SheLLM.git /home/shellmer/shellm
```

### Gemini CLI fails with "Cannot find module './v3'"

Known issue with `@google/gemini-cli` on Node 22. Try reinstalling:

```bash
sudo -iu shellmer
npm install -g @google/gemini-cli@latest
```

If it persists, Gemini CLI has open upstream issues with `googleapis` on Node 22. SheLLM will mark gemini as "Not installed" and continue working with other providers.

### Codex CLI fails with "Missing optional dependency @openai/codex-linux-x64"

The platform-specific binary wasn't installed. Reinstall as shellmer:

```bash
sudo -iu shellmer
npm install -g @openai/codex@latest
```

### npm install -g fails with EACCES as shellmer

The npm global prefix needs to be set to shellmer's home directory. The setup script does this automatically, but if you're installing manually:

```bash
sudo -iu shellmer
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=$HOME/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @openai/codex@latest   # now works without root
```

### .env not being loaded / "SHELLM_ADMIN_PASSWORD not configured"

The `.env` file must be inside the project directory, not the home directory:

```
/home/shellmer/shellm/.env    ← correct
/home/shellmer/.env            ← wrong, will not be loaded
```

If you created it in the wrong place:

```bash
mv /home/shellmer/.env /home/shellmer/shellm/.env
chown shellmer:shellmer /home/shellmer/shellm/.env
chmod 600 /home/shellmer/shellm/.env
sudo systemctl restart shellm
```

### "Refusing to start: admin password is too weak"

SheLLM requires the admin password to be at least 12 characters. Edit the `.env` and set a stronger password:

```bash
nano /home/shellmer/shellm/.env
# Change SHELLM_ADMIN_PASSWORD to something >= 12 chars
sudo systemctl restart shellm
```

### How do I check logs after a crash?

```bash
# Last 50 lines of service logs
sudo journalctl -u shellm -n 50 --no-pager

# Service status with exit code
sudo systemctl status shellm

# Follow logs in real time
sudo journalctl -u shellm -f
```

### Is the setup script idempotent / can I run it again?

Yes. Most steps have guards (skip if already exists). It's safe to re-run after fixing an issue. It will pull latest code, reinstall deps, and update the systemd service without losing your `.env` or database.
