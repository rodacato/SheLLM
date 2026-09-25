const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../../src/config');
const schema = require('../../src/config/schema');

// What the code produced before src/config existed, read off the call sites it replaced. ADR-0008
// promises this migration moves where a default is written and never what it is; this table is
// what makes that promise falsifiable rather than a sentence in a document.
const BEFORE = {
  CIRCUIT_BREAKER_RESET_MS: 60000,
  CIRCUIT_BREAKER_THRESHOLD: 3,
  CLAUDE_CODE_OAUTH_TOKEN: null,
  HEALTH_CACHE_TTL_MS: 30000,
  HEALTH_POLL_INTERVAL_MS: 300000,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'info',
  MAX_CONCURRENT: 4,
  MAX_QUEUE_DEPTH: 10,
  MAX_STREAM_CONCURRENT: 4,
  NODE_ENV: null,
  PORT: 6100,
  SHELLM_ADMIN_MAX_ATTEMPTS: 5,
  SHELLM_ADMIN_PASSWORD: null,
  SHELLM_ADMIN_USER: null,
  SHELLM_ALERT_WEBHOOK_URL: null,
  SHELLM_AUTH_ALERT_THRESHOLD: 10,
  SHELLM_CLAUDE_SKIP_PERMISSIONS: true,
  SHELLM_CORS_ORIGINS: [],
  SHELLM_FALLBACK_ENABLED: false,
  SHELLM_FALLBACK_ORDER: null,
  SHELLM_GLOBAL_RPM: 60,
  SHELLM_HMAC_SECRET: null,
  SHELLM_MODEL_CATALOG_TTL_MS: 21600000,
  SHELLM_QUOTA_WEEK_HOURS: 168,
  SHELLM_QUOTA_WINDOW_HOURS: 5,
  SHELLM_REF: null,
  SHELLM_REQUIRE_AUTH: true,
  SHELLM_TLS_CERT: null,
  SHELLM_TLS_KEY: null,
  SHELLM_TRUST_PROXY: null,
  SHELLM_TZ: null,
  TIMEOUT_MS: 300000,
};

// Settings born after the migration, with the default they were introduced with.
const ADDED = {
  SHELLM_MAX_CHAT_BODY_BYTES: 20971520,
  SHELLM_MAX_IMAGES: 8,
  SHELLM_MAX_IMAGE_BYTES: 5242880,
};

const saved = {};

describe('config defaults', () => {
  beforeEach(() => {
    for (const name of config.names()) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    config.reload();
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    config.reload();
  });

  it('covers every setting the schema declares, and no others', () => {
    assert.deepStrictEqual(config.names().sort(), Object.keys({ ...BEFORE, ...ADDED }).sort());
  });

  it('resolves each setting to the value the call sites produced before the migration', () => {
    for (const [name, expected] of Object.entries({ ...BEFORE, ...ADDED })) {
      assert.deepStrictEqual(config.get(name), expected, `${name} changed default`);
    }
  });

  it('reports the default as the source when nothing sets the value', () => {
    for (const name of config.names()) {
      assert.equal(config.sourceOf(name), 'default', `${name} claims a source it does not have`);
    }
  });

  it('keeps the two boolean idioms apart', () => {
    process.env.SHELLM_REQUIRE_AUTH = 'yes';
    assert.equal(config.get('SHELLM_REQUIRE_AUTH'), true, 'opt-out: anything but "false" is on');
    process.env.SHELLM_REQUIRE_AUTH = 'false';
    assert.equal(config.get('SHELLM_REQUIRE_AUTH'), false);

    process.env.SHELLM_FALLBACK_ENABLED = 'yes';
    assert.equal(config.get('SHELLM_FALLBACK_ENABLED'), false, 'opt-in: only "true" is on');
    process.env.SHELLM_FALLBACK_ENABLED = 'true';
    assert.equal(config.get('SHELLM_FALLBACK_ENABLED'), true);
  });

  it('reads an empty value as unset, the way the `||` it replaced did', () => {
    process.env.MAX_CONCURRENT = '';
    assert.equal(config.get('MAX_CONCURRENT'), 4);
  });

  it('keeps a zero, which the `||` it replaced also kept', () => {
    process.env.MAX_CONCURRENT = '0';
    assert.equal(config.get('MAX_CONCURRENT'), 0);
  });

  it('names the restart command the host actually needs', () => {
    const invocation = process.env.INVOCATION_ID;
    try {
      delete process.env.INVOCATION_ID;
      assert.equal(config.restartCommand(), 'shellm restart');
      process.env.INVOCATION_ID = 'c0ffee';
      assert.equal(config.restartCommand(), 'sudo systemctl restart shellm');
    } finally {
      if (invocation === undefined) delete process.env.INVOCATION_ID;
      else process.env.INVOCATION_ID = invocation;
    }
  });

  it('refuses a name it does not declare', () => {
    assert.throws(() => config.get('SHELLM_NOT_A_SETTING'), /Unknown setting/);
  });

  it('declares a since, a reload class and a description for every setting', () => {
    for (const [name, entry] of Object.entries(schema)) {
      assert.match(entry.since, /^v\d+\.\d+\.\d+$/, `${name} has no release`);
      assert.ok(['live', 'restart'].includes(entry.reload), `${name} has no reload class`);
      assert.ok(entry.describe?.trim().length > 20, `${name} has no description`);
    }
  });
});
