/* global Alpine */

function keysPage() {
  return {
    keys: [],
    loading: true,
    loadError: null,
    showCreateModal: false,
    newKeyResult: null,
    createForm: { name: '', rpm: 10, models: '', origins: '', expires_at: '', description: '' },
    editing: null,
    editForm: { rpm: 10, models: '', origins: '', expires_at: '', description: '' },
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
      window.scrollTo(0, 0);
    },

    async copy(id, text) {
      if (await copyToClipboard(text)) {
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

    async createKey() {
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
      if (this.createForm.expires_at) {
        body.expires_at = new Date(this.createForm.expires_at).toISOString();
      }
      if (this.createForm.description.trim()) {
        body.description = this.createForm.description.trim();
      }

      try {
        const res = await apiFetch(`${API_BASE}/keys`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          this.showNewKey({ ...data.key, action: 'created' });
          this.createForm = { name: '', rpm: 10, models: '', origins: '', expires_at: '', description: '' };
          this.showCreateModal = false;
          await this.fetchKeys();
          await this.fetchAuditLogs();
        } else {
          const err = await res.json();
          alert(err.message || 'Failed to create key');
        }
      } catch { alert('Network error'); }
    },

    startEdit(key) {
      this.editing = key.id;
      this.editForm = {
        rpm: key.rpm,
        models: (key.models || []).join(', '),
        origins: (key.origins || []).join(', '),
        // datetime-local wants no zone and no seconds, and the API stores UTC without the marker.
        expires_at: key.expires_at ? key.expires_at.replace(' ', 'T').slice(0, 16) : '',
        description: key.description || '',
      };
    },

    cancelEdit() {
      this.editing = null;
    },

    async saveEdit(key) {
      const body = {
        rpm: parseInt(this.editForm.rpm, 10) || key.rpm,
        models: this.editForm.models.trim() ? this.splitList(this.editForm.models) : null,
        origins: this.editForm.origins.trim() ? this.splitList(this.editForm.origins) : null,
        expires_at: this.editForm.expires_at ? new Date(this.editForm.expires_at + 'Z').toISOString() : null,
        description: this.editForm.description.trim() || null,
      };

      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          return alert(err.message || 'Failed to update key');
        }
        this.editing = null;
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { alert('Network error'); }
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

    async toggleActive(key) {
      const newActive = key.active ? 0 : 1;
      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: newActive }),
        });
        if (!res.ok) {
          const err = await res.json();
          return alert(err.message || 'Failed to update key');
        }
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { alert('Network error'); }
    },

    async rotateKey(key) {
      if (!confirm(`Rotate key for "${key.name}"? The old key will stop working immediately.`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}/rotate`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          return alert(err.message || 'Failed to rotate key');
        }
        const data = await res.json();
        this.showNewKey({ ...data.key, name: key.name, action: 'rotated' });
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { alert('Network error'); }
    },

    async deleteKey(key) {
      if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          return alert(err.message || 'Failed to delete key');
        }
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { alert('Network error'); }
    },

    isExpired(key) {
      return key.expires_at && new Date(key.expires_at + 'Z') < new Date();
    },

    isExpiringSoon(key) {
      if (!key.expires_at) return false;
      const exp = new Date(key.expires_at + 'Z');
      const now = new Date();
      return exp > now && (exp - now) < 7 * 24 * 60 * 60 * 1000;
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
