/* global Alpine */

function wallClockParts(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function zoneOffsetMs(instant, tz) {
  const p = wallClockParts(instant, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

// datetime-local carries no zone, so the field is written and read in the zone the table prints.
function zonedInputValue(value, tz) {
  const d = parseInstant(value);
  if (!d) return '';
  const p = wallClockParts(d, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// The offset depends on the instant being solved for, so a second pass settles it across a DST change.
function instantFromZonedInput(text, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text || '');
  if (!m) return null;
  const wall = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]);
  const first = wall - zoneOffsetMs(new Date(wall), tz);
  return new Date(wall - zoneOffsetMs(new Date(first), tz));
}

const EMPTY_KEY_FORM = () => ({ name: '', rpm: 10, models: '', origins: '', expires_at: '', description: '' });
const UNCOPIED_KEY_WARNING = 'A key that was never copied cannot be read back — rotate it for a new one.';

function keysPage() {
  return {
    // Shut until asked: the same two lines arrive filled in when a key is created, so this card
    // is the reference you return to rather than something to read on arrival.
    connectionOpen: false,
    keys: [],
    loading: true,
    loadError: null,
    showCreateModal: false,
    creating: false,
    createError: null,
    newKeyResult: null,
    keyCopied: false,
    createForm: EMPTY_KEY_FORM(),
    editing: null,
    editError: null,
    editForm: EMPTY_KEY_FORM(),
    rowError: null,
    timezone: dashboardTimezone,
    usagePeriod: '7d',
    auditLogs: [],
    auditError: null,
    showAudit: false,
    copied: null,
    copyError: null,

    get baseUrl() {
      return window.location.origin;
    },

    get snippets() {
      const key = this.newKeyResult?.raw_key;
      return key ? this.snippetsFor(key) : [];
    },

    // The same two lines answer "how do I use this?" for a key created long ago, whose own value
    // is unrecoverable — so the page states them with a placeholder instead of only at creation.
    get sampleSnippets() {
      return this.snippetsFor('$SHELLM_KEY');
    },

    snippetsFor(key) {
      return [
        {
          id: 'openai',
          label: 'OpenAI SDKs',
          help: 'Read the base URL as given, so it carries /v1.',
          command: `export OPENAI_BASE_URL=${this.baseUrl}/v1 OPENAI_API_KEY=${key}`,
        },
        {
          id: 'anthropic',
          label: 'Anthropic SDKs',
          help: 'Append /v1 themselves, so the base URL must not carry it.',
          command: `export ANTHROPIC_BASE_URL=${this.baseUrl} ANTHROPIC_API_KEY=${key}`,
        },
      ];
    },

    // The key is legible exactly once and the banner renders at the top of the page, so a key
    // created from the modal with the table scrolled down would appear off-screen.
    showNewKey(result) {
      this.newKeyResult = result;
      this.keyCopied = false;
      window.scrollTo(0, 0);
    },

    dismissNewKey() {
      if (!this.keyCopied && !confirm(UNCOPIED_KEY_WARNING)) return;
      this.newKeyResult = null;
    },

    async copy(id, text) {
      if (await copyToClipboard(text)) {
        if (id === 'key') this.keyCopied = true;
        this.copied = id;
        this.copyError = null;
        setTimeout(() => { if (this.copied === id) this.copied = null; }, 1500);
        return;
      }
      // Left standing until the next attempt: it is the only thing telling the operator to fall
      // back to selecting the text by hand.
      this.copyError = id;
      this.copied = null;
    },

    splitList(value) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    },

    // Read on every visit, so a failed read never outlives the visit it failed on.
    visit(onPage) {
      if (!this._reader) this._reader = poller(() => { this.fetchKeys(); this.fetchAuditLogs(); });
      if (onPage) this._reader.every(0, { now: true });
      else this._reader.stop();
    },

    async fetchKeys() {
      this.loading = true;
      try {
        const data = await apiRead(`${API_BASE}/keys`);
        this.keys = data.keys;
        this.usagePeriod = data.usage_period || '7d';
        this.loadError = null;
      } catch (err) {
        this.keys = [];
        this.loadError = err.message;
      }
      this.loading = false;
    },

    async fetchAuditLogs() {
      try {
        const data = await apiRead(`${API_BASE}/audit?limit=50`);
        this.auditLogs = data.logs;
        this.auditError = null;
      } catch (err) {
        this.auditLogs = [];
        this.auditError = err.message;
      }
    },

    openCreate() {
      this.timezone = dashboardTimezone;
      this.createError = null;
      this.showCreateModal = true;
      this.$nextTick(() => this.$refs.createName?.focus());
    },

    async createKey() {
      if (this.creating) return;
      const body = {
        name: this.createForm.name.trim(),
        rpm: parseInt(this.createForm.rpm, 10) || 10,
      };
      if (this.createForm.models.trim()) {
        body.models = this.splitList(this.createForm.models);
      }
      if (this.createForm.origins.trim()) {
        body.origins = this.splitList(this.createForm.origins);
      }
      const expires = instantFromZonedInput(this.createForm.expires_at, this.timezone);
      if (expires) body.expires_at = expires.toISOString();
      if (this.createForm.description.trim()) {
        body.description = this.createForm.description.trim();
      }

      this.creating = true;
      this.createError = null;
      try {
        const data = await apiWrite(`${API_BASE}/keys`, { body });
        this.showNewKey({ ...data.key, action: 'created' });
        this.createForm = EMPTY_KEY_FORM();
        this.showCreateModal = false;
      } catch (err) {
        this.createError = err.message;
        return;
      } finally {
        this.creating = false;
      }
      await this.fetchKeys();
      await this.fetchAuditLogs();
    },

    startEdit(key) {
      this.timezone = dashboardTimezone;
      this.editError = null;
      this.editing = key.id;
      this.editForm = {
        name: key.name,
        rpm: key.rpm,
        models: (key.models || []).join(', '),
        origins: (key.origins || []).join(', '),
        expires_at: zonedInputValue(key.expires_at, this.timezone),
        description: key.description || '',
      };
    },

    cancelEdit() {
      this.editing = null;
      this.editError = null;
    },

    async saveEdit(key) {
      const expires = instantFromZonedInput(this.editForm.expires_at, this.timezone);
      const body = {
        name: this.editForm.name.trim() || key.name,
        rpm: parseInt(this.editForm.rpm, 10) || key.rpm,
        models: this.editForm.models.trim() ? this.splitList(this.editForm.models) : null,
        origins: this.editForm.origins.trim() ? this.splitList(this.editForm.origins) : null,
        expires_at: expires ? expires.toISOString() : null,
        description: this.editForm.description.trim() || null,
      };

      this.editError = null;
      try {
        await apiWrite(`${API_BASE}/keys/${key.id}`, { method: 'PATCH', body });
      } catch (err) {
        this.editError = err.message;
        return;
      }
      this.editing = null;
      await this.fetchKeys();
      await this.fetchAuditLogs();
    },

    errorRate(key) {
      const usage = key.usage;
      if (!usage || !usage.requests) return null;
      return Math.round((usage.errors / usage.requests) * 100);
    },

    openKeyLogs(key) {
      Alpine.store('nav').pendingLogFilter = { client: key.name };
      location.hash = 'logs';
    },

    // One line per row, so a refusal is read next to the key it refused.
    async rowAction(key, url, options) {
      this.rowError = null;
      try {
        return { data: await apiWrite(url, options) };
      } catch (err) {
        this.rowError = { id: key.id, message: err.message };
        return null;
      }
    },

    async toggleActive(key) {
      if (this.isExpired(key)) return;
      const body = { active: key.active ? 0 : 1 };
      if (!await this.rowAction(key, `${API_BASE}/keys/${key.id}`, { method: 'PATCH', body })) return;
      await this.fetchKeys();
      await this.fetchAuditLogs();
    },

    async rotateKey(key) {
      if (!confirm(`Rotate key for "${key.name}"? The old key will stop working immediately.`)) return;
      const done = await this.rowAction(key, `${API_BASE}/keys/${key.id}/rotate`, { method: 'POST' });
      if (!done) return;
      this.showNewKey({ ...done.data.key, name: key.name, action: 'rotated' });
      await this.fetchKeys();
      await this.fetchAuditLogs();
    },

    async deleteKey(key) {
      if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
      if (!await this.rowAction(key, `${API_BASE}/keys/${key.id}`, { method: 'DELETE' })) return;
      await this.fetchKeys();
      await this.fetchAuditLogs();
    },

    isExpired(key, now = Date.now()) {
      const exp = parseInstant(key.expires_at);
      return exp !== null && exp.getTime() <= now;
    },

    isExpiringSoon(key, now = Date.now()) {
      const exp = parseInstant(key.expires_at);
      return exp !== null && exp.getTime() > now && exp.getTime() - now < 7 * 24 * 60 * 60 * 1000;
    },

    formatExpiry(key) {
      if (!key.expires_at) return 'Never';
      return formatTime(key.expires_at);
    },

    formatTime,
    formatCost,
    formatCompactNumber,
  };
}
