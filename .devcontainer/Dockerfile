# Keep this thin: language toolchains are devcontainer.json features; only search/edit tools live here.
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    neovim \
    ripgrep \
    fd-find \
    && rm -rf /var/lib/apt/lists/*

# Debian ships fd as fdfind; give it the name every doc and muscle memory uses.
RUN ln -sf "$(which fdfind)" /usr/local/bin/fd
