function modelsPage() {
  return {
    models: [],
    providers: [],
    loading: true,

    async fetchModels() {
      this.loading = true;
      try {
        // Fetch providers (includes models, type, capabilities, health)
        const provRes = await apiFetch(`${API_BASE}/providers`);
        if (provRes.ok) {
          const data = await provRes.json();
          this.providers = data.providers || [];
          // Flatten all models with provider info
          this.models = [];
          for (const prov of this.providers) {
            for (const m of prov.models || []) {
              this.models.push({
                id: m.name,
                provider: prov.name,
                upstream_model: m.upstream_model,
                is_alias: m.is_alias,
                authenticated: prov.authenticated,
                installed: prov.installed,
                enabled: prov.enabled,
              });
            }
          }
        }
      } catch { /* ignore */ }
      this.loading = false;
    },

    providerStatus(providerName) {
      return this.providers.find((p) => p.name === providerName) || null;
    },

    async toggleProvider(name, enable) {
      const action = enable ? 'Enable' : 'Disable';
      if (!confirm(`${action} provider "${name}"? ${enable ? 'It will start receiving requests.' : 'Active requests to this provider will fail.'}`)) return;
      try {
        await apiFetch(`${API_BASE}/providers/${name}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: enable ? 1 : 0 }),
        });
        await this.fetchModels();
        if (this.$root?.fetchHealth) await this.$root.fetchHealth();
      } catch { /* ignore */ }
    },
  };
}
