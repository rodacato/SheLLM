function keysPage() {
  return {
    keys: [],
    loading: true,
    showCreateModal: false,
    newKeyResult: null,
    createForm: { name: '', rpm: 10, models: '' },

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

    async createKey() {
      const body = {
        name: this.createForm.name.trim(),
        rpm: parseInt(this.createForm.rpm, 10) || 10,
      };
      if (this.createForm.models.trim()) {
        body.models = this.createForm.models.split(',').map((m) => m.trim()).filter(Boolean);
      }

      try {
        const res = await apiFetch(`${API_BASE}/keys`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          this.newKeyResult = data.key;
          this.createForm = { name: '', rpm: 10, models: '' };
          this.showCreateModal = false;
          await this.fetchKeys();
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
        }
      } catch { /* ignore */ }
    },

    async deleteKey(key) {
      if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
      try {
        await apiFetch(`${API_BASE}/keys/${key.id}`, { method: 'DELETE' });
        await this.fetchKeys();
      } catch { /* ignore */ }
    },

    formatTime,
  };
}
