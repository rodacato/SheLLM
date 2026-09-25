'use strict';

// The single declaration of what SheLLM can be configured with. `.env.example` is generated from
// it and CI diffs the result, so a default lives here and nowhere else. See docs/adr/0008.
//
// since   the first release whose src/ read the variable, not when it was documented
// reload  live    — a running server picks the change up
//         restart — frozen at boot, or bound to something already started
// secret  never rendered with a value, and masked wherever the value is reported

module.exports = {
  // --- Server ---
  PORT: {
    section: 'Server', type: 'int', default: 6100, since: 'v0.1.0', reload: 'restart', prominent: true,
    describe: 'Port the HTTP server listens on',
  },
  HOST: {
    section: 'Server', type: 'string', default: '127.0.0.1', since: 'v1.0.0', reload: 'restart', prominent: true,
    describe: 'Interface to bind. Loopback keeps SheLLM reachable only through a local tunnel or proxy.',
  },
  LOG_LEVEL: {
    section: 'Server', type: 'string', default: 'info', since: 'v0.1.0', reload: 'restart', prominent: true,
    describe: 'Log level: debug, info, warn, error',
  },
  SHELLM_TZ: {
    section: 'Server', type: 'string', default: null, since: 'v1.6.0', reload: 'live', example: 'America/Mexico_City',
    describe: `IANA timezone the admin dashboard renders every timestamp in — tables, charts and axis
      labels. Server logs stay UTC. An unknown name falls back to the default instead of failing.`,
  },
  SHELLM_CORS_ORIGINS: {
    section: 'Server', type: 'list', default: [], since: 'v1.10.0', reload: 'live',
    example: 'https://you.github.io,http://localhost:5173',
    describe: `Origins allowed to call /v1 from a browser, comma-separated. Empty disables CORS
      entirely, which is the default. Exact match — scheme, host and port, no path, no trailing
      slash, and no wildcard. The admin endpoints are never included. See "Using SheLLM from a
      browser" in README.md.`,
  },
  SHELLM_TLS_CERT: {
    section: 'Server', type: 'string', default: null, since: 'v1.10.0', reload: 'restart', example: '/etc/shellm/tls/cert.pem',
    describe: `Serve HTTPS instead of plain HTTP. Both this and SHELLM_TLS_KEY are needed; either
      alone is ignored. HTTP/1.1 only — for HTTP/2 put Caddy in front, as the README describes.`,
  },
  SHELLM_TLS_KEY: {
    section: 'Server', type: 'string', default: null, since: 'v1.10.0', reload: 'restart', example: '/etc/shellm/tls/key.pem',
    describe: 'Private key for SHELLM_TLS_CERT. Ignored unless both are set.',
  },
  SHELLM_TRUST_PROXY: {
    section: 'Server', type: 'string', default: null, since: 'v1.10.0', reload: 'restart', example: 'loopback',
    describe: `Trust X-Forwarded-* when something really does sit in front: "loopback", a hop count,
      or the proxy's address. Off by default, because otherwise a caller can forge its own IP and
      the admin login lockout counts the wrong one.`,
  },

  // --- Providers ---
  CLAUDE_CODE_OAUTH_TOKEN: {
    section: 'Providers', type: 'string', default: null, since: 'v1.0.0', reload: 'restart', secret: true,
    describe: 'Long-lived Claude token from `claude setup-token`. Optional when the CLI is logged in for this user.',
  },
  TIMEOUT_MS: {
    section: 'Providers', type: 'int', default: 300000, since: 'v0.1.0', reload: 'live', prominent: true,
    describe: `Max time (ms) to wait for a CLI process before killing it. A proxy in front with a
      shorter read timeout cuts a non-streaming request first; stream long answers.`,
  },
  SHELLM_CLAUDE_SKIP_PERMISSIONS: {
    section: 'Providers', type: 'bool', default: true, since: 'v0.4.0', reload: 'live',
    describe: `Claude runs with --dangerously-skip-permissions so it never waits for a prompt. Set to
      false to remove the flag (a tool request will then hang until the timeout).`,
  },

  // --- Load ---
  MAX_CONCURRENT: {
    section: 'Load', type: 'int', default: 4, since: 'v0.1.0', reload: 'live', prominent: true,
    describe: `Max CLI processes running at the same time. Requests beyond this wait in the queue;
      it limits subprocess spawns, not Express.`,
  },
  MAX_QUEUE_DEPTH: {
    section: 'Load', type: 'int', default: 10, since: 'v0.1.0', reload: 'live', prominent: true,
    describe: 'Max requests waiting when every slot is busy. Beyond this, requests get HTTP 429.',
  },
  MAX_STREAM_CONCURRENT: {
    section: 'Load', type: 'int', default: 4, since: 'v0.3.0', reload: 'restart',
    describe: 'Max concurrent streaming responses',
  },
  SHELLM_GLOBAL_RPM: {
    section: 'Load', type: 'int', default: 60, since: 'v0.1.0', reload: 'live',
    describe: 'Global rate limit across all API keys, requests per minute',
  },
  SHELLM_MAX_CHAT_BODY_BYTES: {
    section: 'Load', type: 'int', default: 20971520, since: 'v1.13.0', reload: 'restart',
    describe: `Largest request body /v1/chat/completions accepts, in bytes, where images arrive as
      base64. It is read only after the key is checked; every other endpoint stays at 256 kB.`,
  },
  SHELLM_MAX_IMAGES: {
    section: 'Load', type: 'int', default: 8, since: 'v1.13.0', reload: 'live',
    describe: 'Most images one /v1/chat/completions request may carry. 0 turns images off.',
  },
  SHELLM_MAX_IMAGE_BYTES: {
    section: 'Load', type: 'int', default: 5242880, since: 'v1.13.0', reload: 'live',
    describe: `Largest image accepted, in decoded bytes. Claude downsizes anything over about 1568 px
      on its long edge, so resizing before sending costs nothing and saves the upload.`,
  },

  // --- Auth ---
  SHELLM_ADMIN_PASSWORD: {
    section: 'Auth', type: 'string', default: null, since: 'v0.1.0', reload: 'restart', secret: true,
    describe: `Admin password for /admin/* and the dashboard login (generated by \`shellm init\`).
      When unset, every admin endpoint returns 501.`,
  },
  SHELLM_ADMIN_USER: {
    section: 'Auth', type: 'string', default: null, since: 'v0.1.0', reload: 'restart', example: 'admin',
    describe: 'Only this username is accepted when set; otherwise any username with the right password works.',
  },
  SHELLM_ADMIN_MAX_ATTEMPTS: {
    section: 'Auth', type: 'int', default: 5, since: 'v0.1.0', reload: 'live',
    describe: 'Failed admin logins per IP before a 5-minute lockout',
  },
  SHELLM_REQUIRE_AUTH: {
    section: 'Auth', type: 'bool', default: true, since: 'v0.4.0', reload: 'restart',
    describe: 'Reject /v1/* requests when no API key exists, instead of running unauthenticated',
  },
  SHELLM_HMAC_SECRET: {
    section: 'Auth', type: 'string', default: null, since: 'v0.4.0', reload: 'restart', secret: true,
    describe: `HMAC secret for API key hashing. Auto-generated and stored in the database when unset;
      set it explicitly only to keep keys valid across a restore into a different database.`,
  },

  // --- Health and alerts ---
  HEALTH_CACHE_TTL_MS: {
    section: 'Health and alerts', type: 'int', default: 30000, since: 'v0.1.0', reload: 'live', prominent: true,
    describe: 'How long (ms) provider health results are cached before re-probing',
  },
  HEALTH_POLL_INTERVAL_MS: {
    section: 'Health and alerts', type: 'int', default: 300000, since: 'v0.3.0', reload: 'live',
    describe: 'How often (ms) the background poller runs `--version` checks. Spends no quota.',
  },
  SHELLM_ALERT_WEBHOOK_URL: {
    section: 'Health and alerts', type: 'string', default: null, since: 'v0.3.0', reload: 'live', secret: true,
    describe: 'POST alerts (provider health transitions, auth failure spikes) to Slack, Discord, Uptime Kuma…',
  },
  SHELLM_AUTH_ALERT_THRESHOLD: {
    section: 'Health and alerts', type: 'int', default: 10, since: 'v0.4.0', reload: 'live',
    describe: 'Auth failures in one minute before the webhook fires',
  },

  // --- Routing (off by default) ---
  SHELLM_FALLBACK_ENABLED: {
    section: 'Routing (off by default)', type: 'bool', default: false, since: 'v0.3.0', reload: 'restart',
    describe: 'Retry a failed request on another provider, in priority order. Off unless set to true.',
  },
  SHELLM_FALLBACK_ORDER: {
    section: 'Routing (off by default)', type: 'string', default: null, since: 'v0.3.0', reload: 'restart', example: 'claude,codex',
    describe: 'The provider priority order fallback walks. Ignored while SHELLM_FALLBACK_ENABLED is off.',
  },
  CIRCUIT_BREAKER_THRESHOLD: {
    section: 'Routing (off by default)', type: 'int', default: 3, since: 'v0.3.0', reload: 'restart',
    describe: "Consecutive failures before a provider's circuit opens",
  },
  CIRCUIT_BREAKER_RESET_MS: {
    section: 'Routing (off by default)', type: 'int', default: 60000, since: 'v0.3.0', reload: 'restart',
    describe: 'How long (ms) an open circuit stays open before a provider is tried again',
  },

  // --- Dashboard ---
  SHELLM_MODEL_CATALOG_TTL_MS: {
    section: 'Dashboard', type: 'int', default: 21600000, since: 'v1.5.0', reload: 'restart',
    describe: 'How long (ms) the model list read from the CLIs is cached before asking again (6h)',
  },
  SHELLM_QUOTA_WINDOW_HOURS: {
    section: 'Dashboard', type: 'int', default: 5, since: 'v1.0.0', reload: 'restart',
    describe: 'The short window the dashboard reports consumption over, in hours',
  },
  SHELLM_QUOTA_WEEK_HOURS: {
    section: 'Dashboard', type: 'int', default: 168, since: 'v1.0.0', reload: 'restart',
    describe: 'The long window the dashboard reports consumption over, in hours',
  },

  // --- Process ---
  NODE_ENV: {
    section: 'Process', type: 'string', default: null, since: 'v0.4.0', reload: 'restart', example: 'production',
    describe: `\`production\` is what arms the guards: a weak admin password refuses to start and a
      run with no API keys logs CRITICAL. The systemd unit sets it; \`shellm start -d\` on a server
      does not.`,
  },
  SHELLM_REF: {
    section: 'Process', type: 'string', default: null, since: 'v1.1.0', reload: 'restart',
    describe: 'Which ref `sudo shellm update` installs. A release tag, and only over SSH — see src/cli/update.js',
  },
};
