function modelsPage() {
  return {
    models: [],
    loading: true,

    async fetchModels() {
      this.loading = true;
      try {
        const res = await apiFetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          this.models = data.data || [];
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    resolveProvider(modelId) {
      const providers = Object.keys(this.$root.health?.providers || {});
      for (const p of providers) {
        if (modelId.startsWith(p) || modelId === p) return p;
      }
      return 'unknown';
    },

    providerStatus(modelId) {
      const name = this.resolveProvider(modelId);
      return this.$root.health?.providers?.[name] || null;
    },

    async toggleProvider(name, enable) {
      try {
        await apiFetch(`${API_BASE}/providers/${name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: enable ? 1 : 0 }),
        });
        if (this.$root?.fetchHealth) await this.$root.fetchHealth();
      } catch { /* ignore */ }
    },
  };
}
