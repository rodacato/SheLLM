/* global Alpine */

function keysPage() {
  return {
    keys: [],
    loading: true,
    loadError: null,
    showCreateModal: false,
    newKeyResult: null,
    createForm: { name: '', rpm: 10, models: '', expires_at: '', description: '' },
    editing: null,
    editForm: { rpm: 10, models: '', expires_at: '', description: '' },
    usagePeriod: '7d',
    auditLogs: [],
    auditError: null,
    showAudit: false,

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
        body.models = this.createForm.models.split(',').map((m) => m.trim()).filter(Boolean);
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
          this.newKeyResult = data.key;
          this.createForm = { name: '', rpm: 10, models: '', expires_at: '', description: '' };
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
        models: this.editForm.models.trim()
          ? this.editForm.models.split(',').map((m) => m.trim()).filter(Boolean)
          : null,
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
        this.newKeyResult = { ...data.key, name: key.name };
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
