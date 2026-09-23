# Devcontainer

How credentials reach this container, what survives a rebuild, and what deploy tooling can do
from inside it. For getting the app running, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Host requirements

- **Docker** with Compose **2.24 or later** — the optional `env_file` entry needs it.
- **VS Code** with the **Dev Containers** extension.
- **`gh` logged in on the host** — optional, recommended. Without it `gh` inside the container
  starts logged out after every rebuild.
- **An SSH agent with your key loaded** — for `git push` over SSH and for reaching your server.
  `ssh-add -l` on the host should list it.

## What the container inherits

| Credential | How it arrives | Survives a rebuild? |
|---|---|---|
| `git push` / `git pull` over SSH | VS Code forwards the host's SSH agent (`SSH_AUTH_SOCK`) | Yes |
| SSH to your server | The same forwarded agent | Yes |
| `gh` CLI | `initialize.sh` runs `gh auth token` on the host into `.host.env` → `GH_TOKEN` | Yes |
| `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_ACTOR` | `initialize.sh` derives them from the `origin` remote | Yes |
| Git author name and email | VS Code copies the host's `~/.gitconfig` | Yes |
| `HOST_IP` | `local.env`, which you write | Yes |
| `claude`, `codex` logins | Not inherited — you log in once inside the container; named volumes keep `~/.claude`, `~/.codex` | Yes |
| Production secrets | Not inherited, by design | **No** |

`initializeCommand` runs `initialize.sh` **on the host** before every start. It writes
`.devcontainer/.host.env` (mode 600, gitignored) and always exits 0, so a host without `gh` or
`git` still opens the container. Compose loads `.host.env` and then `local.env` as environment
files; both are optional, and a variable set in `local.env` wins.

Environment files are read when the container is **created**. Reopening an existing container
keeps the old values; **Dev Containers: Rebuild Container** picks up new ones.

## First open

1. On the host, optionally: `gh auth login`, and `ssh-add` your key.
2. Only if you will reach your server from the container, before opening:
   ```bash
   cp .devcontainer/local.env.example .devcontainer/local.env
   $EDITOR .devcontainer/local.env    # HOST_IP
   ```
   Doing this after the container exists works too, followed by a rebuild.
3. Open the folder in VS Code and run **Dev Containers: Reopen in Container**. `post-create.sh`
   fixes volume ownership, runs `npm install`, installs the Codex CLI when missing,
   and creates `~/.config/shellm/env` from `.env.example` on first creation. That copy has every
   secret commented out, so `shellm init` is still what makes `/admin/*` answer. `.env.example` is
   generated from `src/config/schema.js`; to change a setting, edit your own
   `~/.config/shellm/env` and restart, and run `shellm config` to see what is in effect.
4. Check, in a container terminal:
   ```bash
   gh auth status          # "Logged in … (GH_TOKEN)" when the host was logged in
   env | grep ^GITHUB_     # the three derived values
   ```
5. Log in to each provider you want to exercise — `claude`, `codex` — once. The
   logins live in named volumes and survive rebuilds.

## Deploy tooling from the container

This repo has no deploy tooling. SheLLM runs on the server under systemd; with `HOST_IP` set,
`ssh "$HOST_IP"` reaches it through the forwarded agent, and `scripts/setup/vps.sh` documents the
provisioning. No production secret lives in this container.

## Security model

- **The token carries every scope of the host's `gh` login** — usually `repo`, `read:org` and
  `gist` — not a scope chosen for this container.
- **It sits in the container's environment**, readable by every process in it (extensions,
  AI agents, `docker inspect` on the host), and **in plain text in `.host.env`** on disk. The file
  is gitignored and excluded from the image build context by `.dockerignore`.
- **This is no worse than `gh auth login` inside the container**, which writes a token in plain
  text to `~/.config/gh/hosts.yml`, since there is no keyring to hold it. The difference: it is
  the host's own token, so revoking it logs the host out too.
- **To narrow it**, put a fine-grained personal access token scoped to this repository in
  `local.env` as `GH_TOKEN`. It overrides the inherited one in the environment; `.host.env` is
  still written.
- **Provider logins are subscription credentials.** The `claude-auth` and
  `codex-auth` volumes hold OAuth tokens for your own subscriptions; anything running in the
  container can read them. Remove the volumes (`docker volume rm`) to log out for good.
- **Without `gh` on the host**, `GH_TOKEN` is simply absent. `gh auth login` inside the container
  works until the next rebuild.
- **On Windows**, `initializeCommand` runs under `cmd.exe`. With Git for Windows' `sh` on the
  `PATH` it behaves as above; without it the command falls through, no `.host.env` is written,
  and the `GITHUB_*` values have to go in `local.env`.
  Untested on Windows. Under WSL it is Linux, and needs `gh` installed inside WSL.
- **In Codespaces** the script runs in the cloud host and finds no `gh` login there; Codespaces
  provides its own `GITHUB_TOKEN`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No `GH_TOKEN` or `GITHUB_*` at all, and `.devcontainer/.host.env` does not exist on the host | The container predates `initialize.sh` — **Reopen in Container** attached to an existing container instead of creating one | **Dev Containers: Rebuild Container**. If a container from the old `shellm-dev` service is still running, remove it first: `docker rm -f shellm_devcontainer-shellm-dev-1` |
| `$HOST_IP` is empty | No `local.env`, or the container predates it | Create it from `local.env.example`, then **Rebuild Container** |
| An edit to `local.env` has no effect | Environment files are read at creation; reopening does not recreate | **Rebuild Container** |
| `gh` asks you to log in | The host's `gh` is not logged in, is not on the `PATH` VS Code starts with, or was logged in after the container was created | `gh auth status` on the host, then **Rebuild Container** |
| `EACCES` writing to `~/.claude`, `~/.codex` or `node_modules` | A volume was created root-owned and `post-create.sh` has not run since | Run `bash .devcontainer/post-create.sh` |
| `better-sqlite3` fails to load (invalid ELF header, or `NODE_MODULE_VERSION` mismatch) | `node_modules` was built on the host, or under an older Node | Run `bash .devcontainer/post-create.sh`; if it persists, delete the `node_modules` volume and **Rebuild Container** |
| `ssh-add -l` says it cannot connect to the agent, or SSH fails with `Permission denied (publickey)` | The agent is forwarded only to processes VS Code starts; `docker exec` and outside terminals have no `SSH_AUTH_SOCK`, and the host agent may hold no key | Use a VS Code terminal; on the host, `ssh-add` your key |
