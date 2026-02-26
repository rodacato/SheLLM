FROM node:22-slim

LABEL org.opencontainers.image.title="shellm" \
      org.opencontainers.image.description="LLM CLI services unified as a REST API"

# System packages (minimal — no sudo, nano, vim)
# curl: Claude Code installer + healthcheck
# jq: auth scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# CLI installations (version-pinned via build args)
ARG GEMINI_CLI_VERSION=0.30.0
ARG CODEX_CLI_VERSION=0.105.0

RUN npm install -g \
    @google/gemini-cli@${GEMINI_CLI_VERSION} \
    @openai/codex@${CODEX_CLI_VERSION} \
    && npm cache clean --force

RUN chown -R node:node /usr/local/lib/node_modules \
    && chown -R node:node /usr/local/bin

# Pre-create volume mount points with correct ownership
RUN mkdir -p /home/node/.claude /home/node/.gemini /home/node/.codex \
    && chown -R node:node /home/node/.claude /home/node/.gemini /home/node/.codex

# Switch to non-root user
USER node

# Claude Code via native installer (always fetches latest)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/node/.local/bin:${PATH}"

# Application setup
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/setup-auth.sh scripts/check-auth.sh ./scripts/

ENV NODE_ENV=production \
    PORT=6000 \
    TIMEOUT_MS=120000 \
    MAX_CONCURRENT=2 \
    MAX_QUEUE_DEPTH=10 \
    HEALTH_CACHE_TTL_MS=30000 \
    NO_COLOR=1

EXPOSE 6000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:6000/health || exit 1

CMD ["node", "src/server.js"]
