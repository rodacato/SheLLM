function keysPage() {
  return {
    keys: [],
    loading: true,
    showCreateModal: false,
    newKeyResult: null,
    createForm: { name: '', rpm: 10, models: '', expires_at: '', description: '' },
    auditLogs: [],
    showAudit: false,

    async fetchKeys() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/keys`);
        if (res.ok) {
          const data = await res.json();
          this.keys = data.keys;
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    async fetchAuditLogs() {
      try {
        const res = await apiFetch(`${API_BASE}/audit?limit=50`);
        if (res.ok) {
          const data = await res.json();
          this.auditLogs = data.logs;
        }
      } catch { /* ignore */ }
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

    async toggleActive(key) {
      const newActive = key.active ? 0 : 1;
      try {
        await apiFetch(`${API_BASE}/keys/${key.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: newActive }),
        });
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { /* ignore */ }
    },

    async rotateKey(key) {
      if (!confirm(`Rotate key for "${key.name}"? The old key will stop working immediately.`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/keys/${key.id}/rotate`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.newKeyResult = { ...data.key, name: key.name };
          await this.fetchKeys();
          await this.fetchAuditLogs();
        }
      } catch { /* ignore */ }
    },

    async deleteKey(key) {
      if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
      try {
        await apiFetch(`${API_BASE}/keys/${key.id}`, { method: 'DELETE' });
        await this.fetchKeys();
        await this.fetchAuditLogs();
      } catch { /* ignore */ }
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
  };
}
