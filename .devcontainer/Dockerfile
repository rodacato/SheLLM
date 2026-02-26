FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    nano \
    vim-tiny \
    openssl \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Give node user sudo access (needed for occasional system tasks)
RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node

# Install Gemini CLI and Codex CLI globally as root (npm packages)
RUN npm install -g @google/gemini-cli @openai/codex

# Fix permissions for global node modules
RUN chown -R node:node /usr/local/lib/node_modules
RUN chown -R node:node /usr/local/bin

# Pre-create volume mount points with correct ownership (before USER switch)
# This ensures Docker volumes inherit node:node ownership instead of root
RUN mkdir -p /home/node/.claude /home/node/.gemini /home/node/.codex \
    && chown -R node:node /home/node/.claude /home/node/.gemini /home/node/.codex

# Switch to node user for all subsequent operations
USER node

# Install Claude Code CLI as node user (native installer, not npm)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/node/.local/bin:${PATH}"

WORKDIR /workspace
