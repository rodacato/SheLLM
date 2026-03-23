function settingsPage() {
  return {
    settings: [],
    loading: true,
    editingKey: null,
    editValue: '',

    async fetchSettings() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/settings`);
        if (res.ok) {
          const data = await res.json();
          this.settings = data.settings || [];
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    startEdit(setting) {
      this.editingKey = setting.key;
      this.editValue = String(setting.value ?? '');
    },

    cancelEdit() {
      this.editingKey = null;
      this.editValue = '';
    },

    async saveEdit(key) {
      try {
        const res = await apiFetch(`${API_BASE}/settings/${key}`, {
          method: 'PATCH',
          body: JSON.stringify({ value: this.editValue }),
        });
        if (res.ok) {
          this.editingKey = null;
          this.editValue = '';
          await this.fetchSettings();
        }
      } catch { /* ignore */ }
    },

    async resetSetting(key) {
      if (!confirm(`Reset "${key}" to default value?`)) return;
      try {
        await apiFetch(`${API_BASE}/settings/${key}`, { method: 'DELETE' });
        await this.fetchSettings();
      } catch { /* ignore */ }
    },

    sourceBadgeClass(source) {
      switch (source) {
        case 'db': return 'text-primary-container bg-primary-container/10';
        case 'env': return 'text-amber-400 bg-amber-400/10';
        default: return 'text-slate-400 bg-slate-400/10';
      }
    },
  };
}
