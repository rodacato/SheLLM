# Devcontainer

How credentials reach this container, what survives a rebuild, and what deploy tooling can do
from inside it. For getting the app running, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Host requirements

- **Docker** with Compose **2.24 or later** — the optional `env_file` entry needs it.
- **VS Code** with the **Dev Containers** extension.
- **A GitHub token scoped to this repository** — optional, for `gh` inside the container: a
  fine-grained personal access token with only this repository selected and an expiry. The
  container never inherits the host's own `gh` login.
- **An SSH agent with your key loaded** — for `git push` over SSH and for reaching your server.
  `ssh-add -l` on the host should list it.

## What the container inherits

| Credential | How it arrives | Survives a rebuild? |
|---|---|---|
| `git push` / `git pull` over SSH | VS Code forwards the host's SSH agent (`SSH_AUTH_SOCK`) | Yes |
| SSH to your server | The same forwarded agent | Yes |
| `gh` CLI | Not inherited. You log it in from the host with the scoped token (First open, step 4) | **No** — log in again after a rebuild |
| `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_ACTOR` | `initialize.sh` derives them from the `origin` remote | Yes |
| Git author name and email | VS Code copies the host's `~/.gitconfig` | Yes |
| `HOST_IP` | `local.env`, which you write | Yes |
| AI coding agents (Claude Code, Codex…) | Not part of this devcontainer: install and log in the one you use, from the host or inside | Only if its home is kept outside the container layer |
| Production secrets | Not inherited, by design | **No** |

`initializeCommand` runs `initialize.sh` **on the host** before every start. It writes
`.devcontainer/.host.env` (mode 600, gitignored) with no credential in it, and always exits 0,
so a host without `git` still opens the container. Compose loads `.host.env` and then `local.env`
as environment files; both are optional, and a variable set in `local.env` wins.

Environment files are read when the container is **created**. Reopening an existing container
keeps the old values; **Dev Containers: Rebuild Container** picks up new ones.

## First open

1. On the host, optionally: `ssh-add` your key.
2. Only if you will reach your server from the container, before opening:
   ```bash
   cp .devcontainer/local.env.example .devcontainer/local.env
   $EDITOR .devcontainer/local.env    # HOST_IP
   ```
   Doing this after the container exists works too, followed by a rebuild.
3. Open the folder in VS Code and run **Dev Containers: Reopen in Container**. `post-create.sh`
   fixes volume ownership, runs `npm install` and creates `~/.config/shellm/env` from
   `.env.example` on first creation. That copy has every
   secret commented out, so `shellm init` is still what makes `/admin/*` answer. `.env.example` is
   generated from `src/config/schema.js`; to change a setting, edit your own
   `~/.config/shellm/env` and restart, and run `shellm config` to see what is in effect.
4. For `gh`, on the host, from this folder, with the scoped token in `$TOKEN`:
   ```bash
   printf '%s\n' "$TOKEN" | docker exec -i -u vscode \
     "$(docker ps -q --filter label=devcontainer.local_folder="$PWD")" \
     gh auth login -h github.com --with-token
   ```
   The token goes through stdin, never an argument or an environment variable. A rebuild drops the
   login; run it again.
5. Check, in a container terminal:
   ```bash
   gh auth status          # logged in, after step 4
   env | grep ^GITHUB_     # the three derived values
   ```
6. To exercise a provider, its CLI — `claude`, `codex` — has to be installed and logged in
   inside the container. This devcontainer installs neither: bring them with your own tooling,
   or install and log in by hand (a rebuild drops a CLI and login kept in the container layer).

## Deploy tooling from the container

This repo has no deploy tooling. SheLLM runs on the server under systemd; with `HOST_IP` set,
`ssh "$HOST_IP"` reaches it through the forwarded agent, and `scripts/setup/vps.sh` documents the
provisioning. No production secret lives in this container.

## Security model

- **The devcontainer's own files carry no credential.** `.host.env` holds only the three
  `GITHUB_*` values; nothing in `devcontainer.json`, Compose or `local.env` holds a token.
- **The token you log `gh` in with is the whole exposure.** `gh` stores it in plain text in
  `~/.config/gh/hosts.yml`, since the container has no keyring, and every process in the
  container can read it — extensions, AI agents, package install scripts. Scoped to this one
  repository and with an expiry, a leak reaches this repository for a limited time and nothing
  else: not your other repositories, not private ones, not your account.
- **Never pass it as `GH_TOKEN`** in `local.env` or the Compose environment: an environment
  variable beats the stored login, shows up in `docker inspect`, and survives in the container's
  configuration.
- **GitHub Projects owned by a user account are out of reach for fine-grained tokens.** If you
  work a board from here, use a separate classic token with only `project`, `read:org` and
  `read:discussion` for it, never a wider one.
- **Provider logins are subscription credentials.** Wherever a CLI keeps its login inside the
  container, anything running in the container can read it. Log out, or delete that home, to
  revoke it here.
- **On Windows**, `initializeCommand` runs under `cmd.exe`. With Git for Windows' `sh` on the
  `PATH` it behaves as above; without it the command falls through, no `.host.env` is written,
  and the `GITHUB_*` values have to go in `local.env`.
  Untested on Windows. Under WSL it is Linux.
- **In Codespaces**, Codespaces provides its own `GITHUB_TOKEN`; step 4 is not needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No `GITHUB_*` at all, and `.devcontainer/.host.env` does not exist on the host | The container predates `initialize.sh` — **Reopen in Container** attached to an existing container instead of creating one | **Dev Containers: Rebuild Container**. If a container from the old `shellm-dev` service is still running, remove it first: `docker rm -f shellm_devcontainer-shellm-dev-1` |
| `$HOST_IP` is empty | No `local.env`, or the container predates it | Create it from `local.env.example`, then **Rebuild Container** |
| An edit to `local.env` has no effect | Environment files are read at creation; reopening does not recreate | **Rebuild Container** |
| `gh` asks you to log in | The container was rebuilt, or step 4 of First open never ran | Step 4, on the host |
| `gh` answers `Bad credentials`, or 403/404 on another repository | The token expired — or it is scoped to this repository, by design | A new token; another repository gets its own |
| `EACCES` writing to `node_modules` | The volume was created root-owned and `post-create.sh` has not run since | Run `bash .devcontainer/post-create.sh` |
| `better-sqlite3` fails to load (invalid ELF header, or `NODE_MODULE_VERSION` mismatch) | `node_modules` was built on the host, or under an older Node | Run `bash .devcontainer/post-create.sh`; if it persists, delete the `node_modules` volume and **Rebuild Container** |
| `ssh-add -l` says it cannot connect to the agent, or SSH fails with `Permission denied (publickey)` | The agent is forwarded only to processes VS Code starts; `docker exec` and outside terminals have no `SSH_AUTH_SOCK`, and the host agent may hold no key | Use a VS Code terminal; on the host, `ssh-add` your key |
